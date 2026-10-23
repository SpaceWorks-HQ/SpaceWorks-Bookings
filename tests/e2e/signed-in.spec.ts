import { expect, test, type Page } from "@playwright/test";
import { nextTotp } from "./totp";

// Signed-in journeys over the demo data from `npm run db:seed-demo` (the Tinkerspace makerspace and its owner).
// The demo password comes from DEMO_PASSWORD and the owner's authenticator from DEMO_MFA_SECRET; without them
// these tests are skipped.
const password = process.env.DEMO_PASSWORD;
const mfaSecret = process.env.DEMO_MFA_SECRET;
test.skip(!password || !mfaSecret, "DEMO_PASSWORD and DEMO_MFA_SECRET must be set; seed the demo data to run signed-in journeys.");

async function signIn(page: Page, email: string) {
  // Type only after hydration, or React resets the controlled fields.
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.fill('input[autocomplete="email"]', email);
  await page.fill('input[autocomplete="current-password"]', password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const code = page.getByLabel("Authenticator or recovery code");
  await code.waitFor({ timeout: 30_000 });
  await code.fill(await nextTotp(mfaSecret!));
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
}

test("the owner opens the makerspace overview and the team", async ({ page }) => {
  await signIn(page, "owner@demo.test");
  await page.goto("/dashboard/tinkerspace");
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  await expect(page.locator("#main-content").getByText("You're an owner here.")).toBeVisible();
  await page.goto("/dashboard/tinkerspace/team");
  await expect(page.getByRole("heading", { name: "Team", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What each role can do" })).toBeVisible();
  await expect(page.getByText("Bookings manager").first()).toBeVisible();
});

test("the owner reaches payments and the payment settings", async ({ page }) => {
  await signIn(page, "owner@demo.test");
  await page.goto("/dashboard/tinkerspace/payments");
  await expect(page.getByRole("heading", { name: "Payments", level: 1 })).toBeVisible();
  await page.goto("/dashboard/tinkerspace/settings/payments");
  await expect(page.getByRole("heading", { name: "Online payments" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tax and receipts" })).toBeVisible();
});

test("the owner reaches the email and chat notification settings", async ({ page }) => {
  await signIn(page, "owner@demo.test");
  await page.goto("/dashboard/tinkerspace/settings/email");
  await expect(page.getByRole("heading", { name: "Your own email" })).toBeVisible();
  await page.goto("/dashboard/tinkerspace/settings/notifications");
  await expect(page.getByRole("heading", { name: "Chat alerts" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add channel" })).toBeVisible();
});

test("the public makerspace page shows who to contact", async ({ page }) => {
  await page.goto("/m/tinkerspace");
  await expect(page.getByRole("heading", { name: "Tinkerspace", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Spaces" })).toBeVisible();
  await expect(page.getByRole("link", { name: "hello@tinkerspace.demo.test" })).toBeVisible();
});
