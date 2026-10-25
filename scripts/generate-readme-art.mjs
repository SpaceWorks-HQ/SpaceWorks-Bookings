#!/usr/bin/env node
// Draws the README artwork in docs/readme/ (after SpaceWorks-Events scripts/generate-readme-art.ts): the
// 1280×400 banner for light and dark mode, and the brand colour swatches. Run after changing the brand
// masters, Patch or the banner copy, and commit the outputs:
//
//   node scripts/generate-readme-art.mjs
//
// The banner is laid out in HTML and rendered by headless Chromium (the Playwright browser the e2e tests
// use; set PLAYWRIGHT_CHANNEL=msedge to use Edge instead), so Gilroy is embedded exactly as the app ships
// it. The lockup is the unaltered master from public/brand/logo and Patch is public/brand/patch/patch.webp,
// shown smaller than its native size on a Citron panel with clear space all round. Patch is the banner's
// one bold moment, so there is no Unbounded phrase and no Workshop Orange. sharp compresses the PNG.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = (file) => path.join(root, "docs", "readme", file);
const asset = (...parts) => path.join(root, "public", "brand", ...parts);

const WIDTH = 1280;
const HEIGHT = 400;
const PATCH = 216; // px; on the 320 px panel that leaves 52 px all round, a quarter of the badge (~94% of the frame)

/** The seven brand colours (SpaceWorks-Design tokens). */
const BRAND = {
  "deep-ink": "#142C2A",
  "maker-teal": "#006E63",
  "workshop-orange": "#FF7447",
  citron: "#DFFF8F",
  "sky-blue": "#B5CDFF",
  "warm-yellow": "#FFD447",
  "warm-cream": "#FFF4E8",
};

const THEMES = [
  { file: "banner.png", field: BRAND["warm-cream"], ink: BRAND["deep-ink"], muted: "#43544F", rule: "#C9CCC2", lockup: "lockup-horizontal.svg" },
  // Dark mode uses only the brand's reversed pairings; Patch keeps its Citron panel for contrast.
  { file: "banner-dark.png", field: BRAND["deep-ink"], ink: BRAND["warm-cream"], muted: "#D5D3CA", rule: "#4A5C58", lockup: "lockup-horizontal-reversed.svg" },
];

const dataUrl = async (file, type) => `data:${type};base64,${(await readFile(file)).toString("base64")}`;

async function bannerHtml(theme) {
  const [light, extraBold, lockup, patch] = await Promise.all([
    dataUrl(asset("fonts", "Gilroy-Light.woff2"), "font/woff2"),
    dataUrl(asset("fonts", "Gilroy-ExtraBold.woff2"), "font/woff2"),
    dataUrl(asset("logo", theme.lockup), "image/svg+xml"),
    dataUrl(asset("patch", "patch.webp"), "image/webp"),
  ]);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face { font-family: Gilroy; font-weight: 100 549; src: url(${light}) format("woff2"); }
    @font-face { font-family: Gilroy; font-weight: 550 900; src: url(${extraBold}) format("woff2"); }
    * { margin: 0; box-sizing: border-box; }
    html, body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: ${theme.field}; }
    body { position: relative; font-family: Gilroy; color: ${theme.ink}; font-synthesis: none; -webkit-font-smoothing: antialiased; }
    .brand { position: absolute; left: 72px; top: 56px; display: flex; align-items: center; }
    .brand img { width: 300px; height: 48px; display: block; }
    .brand .rule { width: 1.5px; height: 30px; background: ${theme.rule}; margin: 0 20px 0 24px; }
    .brand .product { font-weight: 800; font-size: 28px; line-height: 1; }
    h1 { position: absolute; left: 72px; top: 150px; font-weight: 800; font-size: 62px; line-height: 64px; letter-spacing: -0.02em; }
    .sub { position: absolute; left: 72px; top: 300px; width: 640px; font-weight: 300; font-size: 22px; line-height: 30px; color: ${theme.muted}; }
    .panel { position: absolute; right: 40px; top: 40px; width: 420px; height: 320px; border-radius: 32px; background: ${BRAND.citron}; display: grid; place-items: center; }
    .panel img { width: ${PATCH}px; height: ${PATCH}px; display: block; }
  </style></head><body>
    <div class="brand"><img src="${lockup}" alt=""><span class="rule"></span><span class="product">Makerspace</span></div>
    <h1>Your spaces.<br>Booked, paid, sorted.</h1>
    <p class="sub">Free, open-source space booking for makerspaces.</p>
    <div class="panel"><img src="${patch}" alt=""></div>
  </body></html>`;
}

/** A small rounded swatch for the README palette table, with a hairline so it shows on both GitHub themes. */
const swatch = (hex) => `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="24" viewBox="0 0 48 24"><rect x="0.5" y="0.5" width="47" height="23" rx="6" fill="${hex}" stroke="#7F8C89" stroke-opacity="0.6"/></svg>\n`;

await mkdir(out("screens"), { recursive: true });
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  for (const theme of THEMES) {
    await page.setContent(await bannerHtml(theme), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const shot = await page.screenshot({ type: "png" });
    const png = await sharp(shot).flatten({ background: theme.field }).png({ compressionLevel: 9, palette: true, colours: 192, dither: 0.4 }).toBuffer();
    await writeFile(out(theme.file), png);
    console.log("wrote", path.relative(root, out(theme.file)), `${png.length} bytes`);
  }
} finally {
  await browser.close();
}
for (const [name, hex] of Object.entries(BRAND)) await writeFile(out(`swatch-${name}.svg`), swatch(hex));
console.log(`wrote ${Object.keys(BRAND).length} swatches`);
