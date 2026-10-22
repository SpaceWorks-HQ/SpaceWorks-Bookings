import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { defaultCardDesign } from "@/lib/cards/design/presets";
import { loadCardFonts } from "@/lib/cards/fonts";
import { buildCardScene } from "@/lib/cards/layout";
import { renderMemberCard } from "@/lib/cards/render";
import { renderCardPng } from "@/lib/cards/renderPng";
import { EMPTY_BRANDING, type CardHolder } from "@/lib/cards/types";

/*
 * Card rendering with Indic names and the rupee sign: the fonts must shape (conjuncts, reordered
 * vowel signs), measure what they draw, and both outputs must carry the ink. Set CARD_RENDER_DUMP to
 * a folder to write the PNGs for a visual check.
 */

const MALAYALAM = "ശ്രീക്ഷേത്ര മാധവൻ";
const DEVANAGARI = "क्षत्रिय हिन्दी";

function holder(name: string, extra: Partial<CardHolder> = {}): CardHolder {
  return {
    memberId: "m1",
    verifyToken: "a".repeat(43),
    verifyUrl: `http://localhost:3000/verify/${"a".repeat(43)}`,
    displayName: name,
    role: "Secretary",
    planName: "Annual member · ₹1,200",
    details: [],
    photoUrl: null,
    idNumber: "SWO-0042",
    validUntil: "31 Mar 2027",
    ...extra,
  };
}

const context = { organisationName: "Space Works Kochi", planName: "Annual member" };

async function inkColumns(png: Buffer) {
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  let dark = 0;
  for (const value of data) if (value < 128) dark += 1;
  return { dark, total: info.width * info.height };
}

describe("card fonts", () => {
  it("keeps Indic letters and the rupee sign instead of dropping them", async () => {
    const { measurer } = await loadCardFonts();
    expect(measurer.clean(MALAYALAM)).toBe(MALAYALAM);
    expect(measurer.clean(DEVANAGARI)).toBe(DEVANAGARI);
    expect(measurer.clean("₹1,200")).toBe("₹1,200");
  });

  it("shapes conjuncts and reorders the Devanagari i-matra before its consonant", async () => {
    const fonts = await loadCardFonts();
    const malayalam = fonts.shape("ക്ഷേ", 400);
    // Four code points (ka, virama, ssa, ee sign) shape into fewer glyphs, with the vowel sign first.
    expect(malayalam.glyphs.length).toBeLessThan(4);
    expect(malayalam.glyphs[0]!.glyph.codePoints).toContain(0x0d47);
    const hindi = fonts.shape("हि", 400);
    expect(hindi.glyphs[0]!.glyph.codePoints).toContain(0x093f);
    expect(hindi.glyphs[1]!.glyph.codePoints).toContain(0x0939);
  });

  it("measures shaped text: a conjunct is narrower than its letters drawn apart", async () => {
    const { measurer } = await loadCardFonts();
    const joined = measurer.widthMm("ക്ഷ", 400, 10);
    const apart = measurer.widthMm("ക", 400, 10) + measurer.widthMm("്", 400, 10) + measurer.widthMm("ഷ", 400, 10);
    expect(joined).toBeGreaterThan(0);
    expect(joined).toBeLessThan(apart);
  });
});

describe("card rendering", () => {
  const design = defaultCardDesign(context, "community");

  it("lays out the member's lines and points the QR at the verify page", async () => {
    const { measurer } = await loadCardFonts();
    const scene = buildCardScene({ settings: design.front, holder: holder(MALAYALAM), branding: EMPTY_BRANDING, measurer });
    const texts = scene.ops.flatMap((op) => (op.kind === "text" ? [op.text] : []));
    expect(texts.join(" ")).toContain("മാധവൻ");
    expect(texts).toContain("Secretary");
    expect(texts.some((text) => text.includes("SWO-0042"))).toBe(true);
    expect(scene.ops.find((op) => op.kind === "qr")).toMatchObject({ value: `http://localhost:3000/verify/${"a".repeat(43)}` });
  });

  it.each([["malayalam", MALAYALAM], ["devanagari", DEVANAGARI]])("draws a %s name with ink in the PNG", async (label, name) => {
    const { measurer } = await loadCardFonts();
    const settings = { ...design.front, showQr: false, showPhoto: false, showSymbol: false, showLogo: false, showCardLabel: false, heading: "", showFooter: false, showRole: false, showIdNumber: false, showValidUntil: false };
    const blank = await renderCardPng(buildCardScene({ settings, holder: holder(""), branding: EMPTY_BRANDING, measurer }));
    const png = await renderCardPng(buildCardScene({ settings, holder: holder(name), branding: EMPTY_BRANDING, measurer }));
    if (process.env.CARD_RENDER_DUMP) writeFileSync(join(process.env.CARD_RENDER_DUMP, `card-${label}.png`), png);
    const [empty, inked] = await Promise.all([inkColumns(blank), inkColumns(png)]);
    expect(inked.dark - empty.dark).toBeGreaterThan(inked.total * 0.004);
  });

  it("renders a two-page PDF with the back, including the rupee sign", async () => {
    const pdf = await renderMemberCard({ design, branding: EMPTY_BRANDING }, holder(DEVANAGARI), "pdf", { title: "Card" });
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(2);
    expect(Math.round(doc.getPage(0).getWidth())).toBe(243);
    if (process.env.CARD_RENDER_DUMP) {
      writeFileSync(join(process.env.CARD_RENDER_DUMP, "card.pdf"), pdf);
      writeFileSync(join(process.env.CARD_RENDER_DUMP, "card-front.png"), await renderMemberCard({ design, branding: EMPTY_BRANDING }, holder(MALAYALAM), "png", { title: "Card" }));
    }
  });
});
