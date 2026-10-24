import { expect, test } from "./fixtures";
import { bookPublicSpace, signIn } from "./helpers";

// Money journeys over the seeded demo (no gateway connected, so customers see how to pay offline).
test.skip(!process.env.DEMO_PASSWORD || !process.env.DEMO_MFA_SECRET, "DEMO_PASSWORD and DEMO_MFA_SECRET must be set; seed the demo data to run signed-in journeys.");

test("an approved request is paid at the desk and the booking shows it with a receipt", async ({ page }) => {
  const reference = await bookPublicSpace(page, "Laser studio");
  const manageUrl = page.url();
  await signIn(page, "manager@demo.test");
  await page.goto(`/dashboard/tinkerspace/bookings?q=${reference}&status=REQUESTED`);
  await page.getByRole("link", { name: reference, exact: true }).click();
  await page.waitForURL(/\/dashboard\/tinkerspace\/bookings\/(?!new)[^/?]+$/);
  const bookingUrl = page.url();
  await page.getByRole("button", { name: "Approve booking", exact: true }).click();
  await expect(page.getByText("Approve booking: done.", { exact: true })).toBeVisible();

  await page.context().clearCookies();
  await page.goto(manageUrl);
  await expect(page.getByRole("heading", { name: "Payment", level: 2 })).toBeVisible();
  await expect(page.getByText("How to pay", { exact: true })).toBeVisible();

  await signIn(page, "manager@demo.test");
  await page.goto(bookingUrl);
  await expect(page.getByRole("heading", { name: "Money", level: 2 })).toBeVisible();
  await page.getByRole("button", { name: "Record payment", exact: true }).click();
  await expect(page.getByText("Record payment: done.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /^TINK|^[A-Z0-9]*-?\d{4}-\d{5}$/ }).first()).toBeVisible();
  const statement = await page.request.get(`/api/bookings/tinkerspace/${reference}/statement`);
  expect(statement.ok()).toBe(true);
  expect(statement.headers()["content-type"]).toContain("application/pdf");
});
