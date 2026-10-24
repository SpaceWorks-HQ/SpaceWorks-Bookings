import { expect, test } from "./fixtures";
import { signIn } from "./helpers";

// Staff pages over the seeded demo: the overview figures, calendar, reports, audit log and integrations.
test.skip(!process.env.DEMO_PASSWORD || !process.env.DEMO_MFA_SECRET, "DEMO_PASSWORD and DEMO_MFA_SECRET must be set; seed the demo data to run signed-in journeys.");

test("the owner reads the calendar, reports and audit log, and creates an API key", async ({ page }) => {
  await signIn(page, "owner@demo.test");
  await page.goto("/dashboard/tinkerspace");
  await expect(page.getByText("Arriving today", { exact: true }).filter({ visible: true })).toBeVisible();

  await page.goto("/dashboard/tinkerspace/calendar?view=week");
  await expect(page.getByRole("heading", { name: "Calendar", level: 1 })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: /Meeting room/ }).filter({ visible: true })).toBeVisible();

  await page.goto("/dashboard/tinkerspace/reports?period=30d");
  await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
  await expect(page.getByText("Utilisation by space", { exact: true }).filter({ visible: true })).toBeVisible();
  const csv = await page.request.get("/api/exports/bookings/tinkerspace?period=30d");
  expect(csv.ok()).toBe(true);
  expect(csv.headers()["content-type"]).toContain("text/csv");

  await page.goto("/dashboard/tinkerspace/settings/integrations");
  await page.getByLabel("Key name", { exact: true }).filter({ visible: true }).fill("Playwright key");
  await page.getByRole("button", { name: "Create key", exact: true }).click();
  await expect(page.getByText("Copy this key now", { exact: true })).toBeVisible();
  const token = (await page.locator("code").filter({ hasText: /^swb_/ }).first().innerText()).trim();
  const spaces = await page.request.get("/api/v1/spaces", { headers: { authorization: `Bearer ${token}` } });
  expect(spaces.ok()).toBe(true);
  expect((await spaces.json()).data.length).toBeGreaterThan(0);

  await page.goto("/dashboard/tinkerspace/audit");
  await expect(page.getByRole("heading", { name: "Audit log", level: 1 })).toBeVisible();
  await expect(page.getByText("API key created", { exact: true }).filter({ visible: true }).first()).toBeVisible();
});
