import { expect, test } from "./fixtures";
import { bookPublicSpace } from "./helpers";

// Runs against `npm run db:seed-demo`, with no credentials needed for this guest journey.
test("a guest books the free Meeting room from the makerspace page and downloads an ICS", async ({ page }) => {
  const reference = await bookPublicSpace(page, "Meeting room");
  await expect(page.getByRole("heading", { name: `Your booking · ${reference}`, exact: true })).toBeVisible();
  await expect(page.getByText(/^Confirmed ·/)).toBeVisible();
  const calendar = page.getByRole("link", { name: "Add to calendar (ICS)", exact: true });
  await expect(calendar).toBeVisible();
  const href = await calendar.getAttribute("href");
  expect(href).toContain(`/api/bookings/tinkerspace/${reference}/calendar?t=`);
  const response = await page.request.get(href!);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("text/calendar");
  const ics = await response.text();
  expect(ics).toContain("BEGIN:VCALENDAR");
  expect(ics).toContain("BEGIN:VEVENT");
  expect(ics).toContain("Meeting room");
});
