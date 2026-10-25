// Operator-only README screenshot capture against the seeded demo (`npm run db:seed-demo`). Never point it at
// production.
//
//   DEMO_PASSWORD=... DEMO_MFA_SECRET=... node scripts/capture-readme-screens.mjs http://127.0.0.1:3011
//
// Every screen is captured in light and dark mode as WebP under docs/screenshots/ (<name>.webp, <name>-dark.webp).
import { chromium } from "@playwright/test";
import * as OTPAuth from "otpauth";
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const base = new URL(process.argv[2] || "http://127.0.0.1:3011");
if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error("Use an HTTP(S) base URL without credentials.");
const password = process.env.DEMO_PASSWORD;
const secret = process.env.DEMO_MFA_SECRET;
if (!password || !secret) throw new Error("Set DEMO_PASSWORD and DEMO_MFA_SECRET to the seeded demo's.");
const out = path.resolve(import.meta.dirname, "../docs/screenshots");
await mkdir(out, { recursive: true });
const staff = "/dashboard/tinkerspace";

/** [file name, signed in as the bookings manager?, route or resolver, viewport] */
const SCREENS = [
  ["makerspace", false, "/m/tinkerspace"],
  ["space-booking", false, "/m/tinkerspace/spaces/meeting-room"],
  ["overview", true, staff],
  ["calendar", true, `${staff}/calendar?view=week`],
  ["today", true, `${staff}/today`],
  ["bookings", true, `${staff}/bookings`],
  ["booking-money", true, async (page) => firstLink(page, `${staff}/bookings?q=BK-DE0007`, `${staff}/bookings/`, "#money")],
  ["space-pricing", true, async (page) => firstLink(page, `${staff}/spaces`, `${staff}/spaces/`, "?tab=pricing")],
  ["booking-rules", true, `${staff}/settings/bookings`],
  ["reports", true, `${staff}/reports?period=30d`],
  ["reconciliation", true, `${staff}/payments/reconciliation`],
  ["integrations", true, `${staff}/settings/integrations`],
  ["issue", true, async (page) => firstLink(page, `${staff}/issues?status=CLOSED`, `${staff}/issues/`)],
  ["technicians", true, `${staff}/technicians`],
  ["finance", true, `${staff}/finance?period=30d`],
  ["space-booking-phone", false, "/m/tinkerspace/spaces/meeting-room", { width: 390, height: 844 }],
];

async function firstLink(page, listRoute, prefix, suffix = "") {
  await page.goto(new URL(listRoute, base).href, { waitUntil: "networkidle" });
  const href = await page.locator(`a[href^="${prefix}"]`).evaluateAll((links, start) => links.map((link) => link.getAttribute("href")).find((value) => value && value !== start && !value.endsWith("/new")), prefix);
  if (!href) throw new Error(`No link under ${prefix} on ${listRoute}`);
  return `${href}${suffix}`;
}

async function signIn(page) {
  await page.goto(new URL("/login", base).href, { waitUntil: "networkidle" });
  await page.fill('input[autocomplete="email"]', "manager@demo.test");
  await page.fill('input[autocomplete="current-password"]', password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const code = page.getByLabel("Authenticator or recovery code");
  await code.waitFor({ timeout: 30_000 });
  await code.fill(new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate());
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
}

const browser = await chromium.launch();
for (const mode of ["light", "dark"]) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: mode, reducedMotion: "reduce" });
  await context.addCookies([{ name: "swb.theme", value: mode, url: base.origin }]);
  const page = await context.newPage();
  // A development server compiles each route on its first visit.
  page.setDefaultTimeout(120_000);
  page.setDefaultNavigationTimeout(120_000);
  let signedIn = false;
  for (const [name, owner, route, viewport] of SCREENS) {
    if (owner && !signedIn) {
      await signIn(page);
      signedIn = true;
    }
    await page.setViewportSize(viewport ?? { width: 1440, height: 900 });
    const target = typeof route === "function" ? await route(page) : route;
    await page.goto(new URL(target, base).href, { waitUntil: "networkidle" });
    // Client navigation can reset the scroll: bring an anchored section (#money) to the top explicitly.
    const anchor = new URL(target, base).hash;
    if (anchor) await page.locator(anchor).evaluate((element) => element.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(400);
    const png = await page.screenshot({ fullPage: false, animations: "disabled" });
    const file = path.join(out, `${name}${mode === "dark" ? "-dark" : ""}.webp`);
    await sharp(png).webp({ quality: 82 }).toFile(file);
    console.log(`captured ${path.relative(process.cwd(), file)}`);
  }
  await context.close();
}
await browser.close();
