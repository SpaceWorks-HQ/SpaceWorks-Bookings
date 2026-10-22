import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { create, type Font, type Glyph } from "fontkit";
import { PT_TO_MM } from "./design/elements";
import type { FontWeight, TextMeasurer } from "./text";

/*
 * Card type: Gilroy Light (400) and ExtraBold (700) from the brand kit, then OFL Noto Sans faces for
 * what Gilroy lacks (extended Latin, the rupee sign, Malayalam, Devanagari). Text is split into
 * runs by the first face that can draw each character and every run is shaped with fontkit
 * `layout()`, so conjuncts, reordered vowel signs and mark positioning come out right. The same
 * shaping measures text for layout and draws it in both the PDF and the PNG, with no system fonts.
 */

const PUBLIC = path.join(process.cwd(), "public");
const CHAINS: Record<FontWeight, string[]> = {
  400: ["brand/fonts/Gilroy-Light.woff2", "fonts/noto/NotoSans-Latin-400.woff2", "fonts/noto/NotoSans-LatinExt-400.woff2", "fonts/noto/NotoSansMalayalam-400.woff2", "fonts/noto/NotoSansDevanagari-400.woff2"],
  700: ["brand/fonts/Gilroy-ExtraBold.woff2", "fonts/noto/NotoSans-Latin-700.woff2", "fonts/noto/NotoSans-LatinExt-700.woff2", "fonts/noto/NotoSansMalayalam-700.woff2", "fonts/noto/NotoSansDevanagari-700.woff2"],
};
export const FONT_WEIGHTS: FontWeight[] = [400, 700];

/** One shaped glyph: which face of the weight's chain, and where it sits (em units, y up). */
export type ShapedGlyph = { face: number; glyph: Glyph; xEm: number; yEm: number; advances: boolean };
export type ShapedText = { glyphs: ShapedGlyph[]; widthEm: number; advancing: number };

export type CardFonts = {
  faces: Record<FontWeight, Font[]>;
  shape(text: string, weight: FontWeight): ShapedText;
  measurer: TextMeasurer;
};

const ASCII_FALLBACK: Record<string, string> = { "–": "-", "—": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "…": "...", "·": "-", "•": "-", " ": " " };
const JOINERS = new Set([0x200c, 0x200d]);
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const CACHE_LIMIT = 4000;

let loaded: Promise<CardFonts> | null = null;

function faceFor(chain: Font[], cluster: string) {
  const codePoints = [...cluster].map((char) => char.codePointAt(0)!);
  const whole = chain.findIndex((face) => codePoints.every((cp) => cp === 32 || JOINERS.has(cp) || face.hasGlyphForCodePoint(cp)));
  return whole >= 0 ? whole : chain.findIndex((face) => face.hasGlyphForCodePoint(codePoints[0]!));
}

function buildFonts(faces: Record<FontWeight, Font[]>): CardFonts {
  const cache = new Map<string, ShapedText>();

  const shape = (text: string, weight: FontWeight): ShapedText => {
    const key = `${weight}\u0000${text}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const chain = faces[weight];
    // Runs of grapheme clusters that share a face. Spaces stay with the run they are in.
    const runs: Array<{ face: number; text: string }> = [];
    for (const { segment } of segmenter.segment(text)) {
      const last = runs.at(-1);
      const face = segment === " " && last ? last.face : faceFor(chain, segment);
      if (face < 0) continue;
      if (last && last.face === face) last.text += segment;
      else runs.push({ face, text: segment });
    }
    const glyphs: ShapedGlyph[] = [];
    let cursor = 0;
    let advancing = 0;
    for (const run of runs) {
      const font = chain[run.face]!;
      const laid = font.layout(run.text);
      laid.glyphs.forEach((glyph, index) => {
        const position = laid.positions[index]!;
        const advances = position.xAdvance > 0;
        glyphs.push({ face: run.face, glyph, xEm: cursor + position.xOffset / font.unitsPerEm, yEm: position.yOffset / font.unitsPerEm, advances });
        cursor += position.xAdvance / font.unitsPerEm;
        if (advances) advancing += 1;
      });
    }
    const shaped = { glyphs, widthEm: cursor, advancing };
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    cache.set(key, shaped);
    return shaped;
  };

  // Keep only characters some face of both weights can draw, so measuring and drawing agree.
  const supports = (codePoint: number) => codePoint === 32 || JOINERS.has(codePoint) || FONT_WEIGHTS.every((weight) => faces[weight].some((face) => face.hasGlyphForCodePoint(codePoint)));
  const clean = (value: string) => {
    let out = "";
    for (const char of value.replace(/[\t\r\n]+/g, " ")) {
      const codePoint = char.codePointAt(0)!;
      if (supports(codePoint)) out += char;
      else if (ASCII_FALLBACK[char]) out += ASCII_FALLBACK[char];
      else out += [...char.normalize("NFKD")].filter((part) => supports(part.codePointAt(0)!)).join("");
    }
    return out;
  };

  const regular = faces[400][0]!;
  const measurer: TextMeasurer = {
    widthMm(text, weight, sizePt, trackingEm = 0) {
      const shaped = shape(text, weight);
      return (shaped.widthEm + trackingEm * shaped.advancing) * sizePt * PT_TO_MM;
    },
    ascent: regular.ascent / regular.unitsPerEm,
    descent: Math.abs(regular.descent) / regular.unitsPerEm,
    clean,
  };
  return { faces, shape, measurer };
}

export function loadCardFonts(): Promise<CardFonts> {
  loaded ??= (async () => {
    const load = async (file: string) => {
      const font = create(await readFile(path.join(PUBLIC, file)));
      if (!("layout" in font)) throw new Error(`Card font ${file} is a collection.`);
      return font;
    };
    const [regular, bold] = await Promise.all(FONT_WEIGHTS.map((weight) => Promise.all(CHAINS[weight].map(load))));
    return buildFonts({ 400: regular!, 700: bold! });
  })().catch((error) => {
    loaded = null;
    throw error;
  });
  return loaded;
}

/** Positioned glyphs for one text op, in millimetres from the op's origin (y down), with tracking. */
export function placeGlyphs(fonts: CardFonts, text: string, weight: FontWeight, sizePt: number, trackingEm: number) {
  const shaped = fonts.shape(text, weight);
  const em = sizePt * PT_TO_MM;
  let tracked = 0;
  let started = false;
  return shaped.glyphs.map((item) => {
    // Letter spacing goes between spacing glyphs; marks stay on the glyph they belong to.
    if (item.advances) {
      if (started) tracked += trackingEm;
      started = true;
    }
    const font = fonts.faces[weight][item.face]!;
    return { key: `${weight}:${item.face}:${item.glyph.id}`, glyph: item.glyph, x: (item.xEm + tracked) * em, y: -item.yEm * em, scale: em / font.unitsPerEm };
  });
}
