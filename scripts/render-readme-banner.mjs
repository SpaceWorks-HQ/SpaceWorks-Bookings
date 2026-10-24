// Renders the README banners (docs/readme/banner.png and banner-dark.png, 1280 × 400) from the brand's own lockup,
// fonts and colours (SpaceWorks-Design): flat shapes, 1px lines, the app's tagline. Run once after a brand change:
//
//   node scripts/render-readme-banner.mjs
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const font = async (file) => (await readFile(path.join(root, "public/brand/fonts", file))).toString("base64");
const lockup = async (file) => (await readFile(path.join(root, "public/brand/logo", file))).toString("base64");
const [light, extraBold] = await Promise.all([font("Gilroy-Light.woff2"), font("Gilroy-ExtraBold.woff2")]);

const MODES = {
  light: { file: "banner.png", logo: await lockup("lockup-horizontal.svg"), ground: "#FFF4E8", ink: "#142C2A", muted: "#4C5B57", line: "#142C2A", panel: "#FFFFFF", teal: "#006E63", citron: "#DFFF8F", sky: "#B5CDFF", orange: "#FF7447" },
  dark: { file: "banner-dark.png", logo: await lockup("lockup-horizontal-reversed.svg"), ground: "#142C2A", ink: "#FFF4E8", muted: "#C9D2CC", line: "#FFF4E8", panel: "#1D3B38", teal: "#006E63", citron: "#DFFF8F", sky: "#B5CDFF", orange: "#FF7447" },
};

/** A week of slots drawn in 1px lines, with a few booked in brand colours: the product at a glance. */
function grid(c) {
  const cells = [];
  const booked = { "0-1": c.teal, "1-3": c.citron, "2-0": c.sky, "3-2": c.teal, "4-1": c.orange, "4-3": c.citron, "5-0": c.citron, "6-2": c.sky };
  for (let x = 0; x < 7; x += 1) {
    for (let y = 0; y < 4; y += 1) {
      const fill = booked[`${x}-${y}`];
      cells.push(`<rect x="${x * 56 + 0.5}" y="${y * 56 + 0.5}" width="48" height="48" rx="10" fill="${fill ?? c.panel}" stroke="${c.line}" stroke-width="1" />`);
    }
  }
  return `<svg width="392" height="224" viewBox="0 0 392 224" xmlns="http://www.w3.org/2000/svg">${cells.join("")}</svg>`;
}

function html(c) {
  return `<!doctype html><html><head><style>
    @font-face { font-family: Gilroy; font-weight: 300; src: url(data:font/woff2;base64,${light}) format("woff2"); }
    @font-face { font-family: Gilroy; font-weight: 800; src: url(data:font/woff2;base64,${extraBold}) format("woff2"); }
    html, body { margin: 0; width: 1280px; height: 400px; overflow: hidden; background: ${c.ground}; color: ${c.ink}; font-family: Gilroy, sans-serif; }
    .brand { position: absolute; left: 72px; top: 56px; display: flex; align-items: center; gap: 22px; }
    .brand img { height: 40px; }
    .brand span { font-weight: 800; font-size: 28px; padding-left: 22px; border-left: 1px solid ${c.muted}; line-height: 32px; }
    h1 { position: absolute; left: 72px; top: 118px; margin: 0; font-weight: 800; font-size: 64px; line-height: 70px; letter-spacing: -0.5px; }
    p { position: absolute; left: 72px; top: 296px; margin: 0; font-weight: 300; font-size: 21px; color: ${c.muted}; }
    .grid { position: absolute; right: 88px; top: 96px; }
    .sun { position: absolute; right: 30px; top: 22px; width: 52px; height: 52px; border-radius: 50%; background: ${c.orange}; }
    .hill { position: absolute; right: -60px; bottom: -150px; width: 360px; height: 260px; border-radius: 50%; background: ${c.teal}; }
  </style></head><body>
    <div class="hill"></div><div class="sun"></div>
    <div class="brand"><img src="data:image/svg+xml;base64,${c.logo}" alt="" /><span>Bookings</span></div>
    <h1>Book the space.<br />Get making.</h1>
    <p>Free, open-source space booking for makerspaces and communities.</p>
    <div class="grid">${grid(c)}</div>
  </body></html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 400 }, deviceScaleFactor: 1 });
for (const mode of Object.values(MODES)) {
  await page.setContent(html(mode), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(root, "docs/readme", mode.file) });
  console.log(`rendered docs/readme/${mode.file}`);
}
await browser.close();
