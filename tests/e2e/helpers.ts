import { expect, type Page } from "@playwright/test";
import { nextTotp } from "./totp";

export async function signIn(page: Page, email: string) {
  // Type only after hydration, or React resets the controlled fields.
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.fill('input[autocomplete="email"]', email);
  await page.fill('input[autocomplete="current-password"]', process.env.DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const code = page.getByLabel("Authenticator or recovery code");
  await code.waitFor({ timeout: 30_000 });
  await code.fill(await nextTotp(process.env.DEMO_MFA_SECRET!));
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
}

/** Choose from real availability, moving past closed days; never hardcode a calendar date or a start time. */
export async function chooseFirstFreeTime(page: Page, nextDay = true) {
  const date = page.getByLabel("Date", { exact: true });
  if (nextDay) await page.getByRole("button", { name: "Next day", exact: true }).click();
  const times = page.locator('[aria-label="Free start times"]');
  for (let day = 0; day < 8; day += 1) {
    await expect(page.getByRole("status").filter({ hasText: /^(Choose a start time\.|No free times for this duration)/ })).toBeVisible({ timeout: 30_000 });
    if (await times.getByRole("button").count()) {
      const first = times.getByRole("button").first();
      const label = (await first.innerText()).trim();
      await first.click();
      const match = /^(\d+):(\d+)\s+(AM|PM)$/.exec(label);
      if (!match) throw new Error(`Unexpected start time: ${label}`);
      const hour = Number(match[1]) % 12 + (match[3] === "PM" ? 12 : 0);
      const start = `${await date.inputValue()}T${String(hour).padStart(2, "0")}:${match[2]}`;
      // Wall-clock arithmetic for the demo's Asia/Kolkata inputs, independent of the runner's timezone.
      const end = new Date(new Date(`${start}:00Z`).getTime() + 30 * 60_000).toISOString().slice(0, 16);
      return { start, end };
    }
    await page.getByRole("button", { name: "Next day", exact: true }).click();
  }
  throw new Error("No free start time was offered in the next eight days.");
}

export async function bookPublicSpace(page: Page, name: "Meeting room" | "Laser studio") {
  await page.goto("/m/tinkerspace", { waitUntil: "networkidle" });
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  await chooseFirstFreeTime(page);
  await page.getByLabel("Name", { exact: true }).fill("Playwright customer");
  await page.getByLabel("Email", { exact: true }).fill(`booking-${Date.now()}@example.test`);
  const submit = page.getByRole("button", { name: name === "Laser studio" ? "Request booking" : "Book this space", exact: true });
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  await submit.click();
  await page.waitForURL(/\/m\/tinkerspace\/bookings\/BK-/);
  const heading = await page.getByRole("heading", { level: 1 }).innerText();
  const reference = /BK-[0-9A-HJKMNP-TV-Z]{6}/.exec(heading)?.[0];
  if (!reference) throw new Error(`Missing booking reference: ${heading}`);
  return reference;
}
