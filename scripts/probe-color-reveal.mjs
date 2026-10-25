// Probe the colour-mode reveal in a real Chromium: toggle light→dark from a real control and capture frames at
// about 40/180/360/560/900 ms, logging the running animations, so the reveal's origin, growth and end can be checked.
// Usage: node scripts/probe-color-reveal.mjs <base-url> <out-dir>   (DEMO_PASSWORD/DEMO_MFA_SECRET for the menu case)
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
import { TOTP } from "otpauth";

const base = process.argv[2] ?? "http://127.0.0.1:3011";
const out = process.argv[3] ?? "test-results/reveal";
mkdirSync(out, { recursive: true });
const FRAMES = [40, 180, 360, 560, 900];

async function capture(page, name, toggle) {
  const started = Date.now();
  const animations = page.evaluate(() => new Promise((resolve) => setTimeout(() => resolve(document.getAnimations().map((a) => ({
    pseudo: a.effect?.pseudoElement ?? null, state: a.playState, keyframes: a.effect?.getKeyframes().map((k) => Object.keys(k).filter((key) => !["offset", "easing", "composite", "computedOffset"].includes(key)).join(",")),
  }))), 120)));
  await toggle();
  const log = await animations;
  for (const at of FRAMES) {
    const wait = at - (Date.now() - started);
    if (wait > 0) await page.waitForTimeout(wait);
    await page.screenshot({ path: `${out}/${name}-${String(at).padStart(3, "0")}.png` });
  }
  const mode = await page.evaluate(() => document.documentElement.className);
  console.log(JSON.stringify({ name, animations: log, htmlClass: mode }));
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(new URL("/m/tinkerspace", base).href, { waitUntil: "networkidle" });
  await capture(page, "header-toggle", () => page.getByRole("button", { name: "Switch to dark mode" }).first().click());

  if (process.env.DEMO_PASSWORD && process.env.DEMO_MFA_SECRET) {
    const staff = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await staff.goto(new URL("/login", base).href, { waitUntil: "networkidle" });
    await staff.locator('input[autocomplete="email"]').fill("manager@demo.test");
    await staff.locator('input[autocomplete="current-password"]').fill(process.env.DEMO_PASSWORD);
    await staff.getByRole("button", { name: "Sign in", exact: true }).click();
    await staff.getByLabel("Authenticator or recovery code").fill(new TOTP({ secret: process.env.DEMO_MFA_SECRET }).generate());
    await staff.getByRole("button", { name: "Verify and sign in" }).click();
    await staff.waitForURL((url) => !url.pathname.startsWith("/login"));
    await staff.goto(new URL("/dashboard/tinkerspace", base).href, { waitUntil: "networkidle" });
    await staff.locator("aside").getByRole("button", { name: /Shaan Shoukath/ }).click();
    await capture(staff, "account-menu", () => staff.getByRole("menuitem", { name: "Dark mode" }).click());
  }
} finally {
  await browser.close();
}
