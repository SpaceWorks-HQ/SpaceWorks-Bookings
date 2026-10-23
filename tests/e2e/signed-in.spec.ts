import { expect, test } from "./fixtures";
import { bookPublicSpace, chooseFirstFreeTime, signIn } from "./helpers";

// Signed-in journeys over the demo data from `npm run db:seed-demo` (the Tinkerspace makerspace and its owner).
// The demo password comes from DEMO_PASSWORD and the owner's authenticator from DEMO_MFA_SECRET; without them
// these tests are skipped.
const password = process.env.DEMO_PASSWORD;
const mfaSecret = process.env.DEMO_MFA_SECRET;
test.skip(!password || !mfaSecret, "DEMO_PASSWORD and DEMO_MFA_SECRET must be set; seed the demo data to run signed-in journeys.");

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

test("the owner approves a Laser studio request from the bookings list", async ({ page }) => {
  // Make our own request so other tests and retries can change seeded bookings independently.
  const reference = await bookPublicSpace(page, "Laser studio");
  await expect(page.getByText("Waiting for approval", { exact: true })).toBeVisible();
  await signIn(page, "owner@demo.test");
  await page.goto(`/dashboard/tinkerspace/bookings?q=${reference}&status=REQUESTED`);
  await page.getByRole("link", { name: reference, exact: true }).click();
  await page.getByRole("button", { name: "Approve booking", exact: true }).click();
  await expect(page.getByText("Approve booking: done.", { exact: true })).toBeVisible();
  await page.reload();
  // Next keeps the previous route hidden in the page: count only what is shown.
  await expect(page.getByText("Confirmed", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve booking", exact: true })).toHaveCount(0);
});

test("front desk checks in an arrival from Today", async ({ page }) => {
  await signIn(page, "front@demo.test");
  await page.goto("/dashboard/tinkerspace/today");
  await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
  // The seeded overnight build stays checkable throughout the local day, including Sundays and late runs.
  const row = page.locator("div.border-b").filter({ has: page.getByRole("link", { name: "BK-DE0007", exact: true }) });
  await expect(row).toBeVisible();
  // A retry may follow a successful check-in whose subsequent assertion timed out.
  if (await row.getByRole("button", { name: "Check in", exact: true }).count()) {
    await row.getByRole("button", { name: "Check in", exact: true }).click();
    await expect(page.getByText("Check in: done.", { exact: true })).toBeVisible();
  }
  await page.reload();
  await expect(row.getByText("Checked in", { exact: true })).toBeVisible();
});

test("the owner changes a booking rule default and sees it saved", async ({ page }) => {
  await signIn(page, "owner@demo.test");
  await page.goto("/dashboard/tinkerspace/settings/bookings", { waitUntil: "networkidle" });
  const hold = page.getByLabel("Checkout hold (minutes)", { exact: true }).filter({ visible: true });
  const original = await hold.inputValue();
  const changed = original === "15" ? "20" : "15";
  try {
    await hold.fill(changed);
    await page.getByRole("button", { name: "Save booking rules", exact: true }).click();
    await expect(page.getByText("Save booking rules: done.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(hold).toHaveValue(changed);
  } finally {
    await hold.fill(original);
    await page.getByRole("button", { name: "Save booking rules", exact: true }).click();
    await expect(page.getByText("Save booking rules: done.", { exact: true })).toBeVisible();
  }
});

test("the owner makes a booking on behalf of a customer", async ({ page }) => {
  await page.goto("/m/tinkerspace/spaces/meeting-room", { waitUntil: "networkidle" });
  const slot = await chooseFirstFreeTime(page);
  await signIn(page, "owner@demo.test");
  await page.goto("/dashboard/tinkerspace/bookings/new", { waitUntil: "networkidle" });
  await page.getByRole("combobox", { name: "Space", exact: true }).click();
  await page.getByRole("option", { name: "Meeting room", exact: true }).click();
  await page.getByLabel("Start", { exact: true }).fill(slot.start);
  await page.getByLabel("End", { exact: true }).fill(slot.end);
  await page.getByRole("button", { name: "Hold booking times", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Customer and booking details" })).toBeVisible();
  const customer = `Counter customer ${Date.now()}`;
  await page.getByLabel("Customer name", { exact: true }).fill(customer);
  await page.getByLabel("Customer email", { exact: true }).fill(`counter-${Date.now()}@example.test`);
  await page.getByLabel("Internal notes", { exact: true }).fill("Booked at the counter");
  await page.getByRole("button", { name: "Create booking", exact: true }).click();
  await page.waitForURL(/\/dashboard\/tinkerspace\/bookings\/(?!new)[^/]+$/);
  await expect(page.getByText(customer, { exact: true })).toBeVisible();
  // The timeline and status chip both say Confirmed.
  await expect(page.getByText("Confirmed", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Booked at the counter", { exact: true })).toBeVisible();
});
