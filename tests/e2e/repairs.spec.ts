import { createHash, randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { signIn } from "./helpers";

// Repairs over the seeded demo: a bookings manager reports an issue and asks technicians; the team technician
// (tech@demo.test) accepts and records the fix; the manager verifies, approves and pays; an outside technician works
// through their link; and finance stays with the bookings manager.
test.skip(!process.env.DEMO_PASSWORD || !process.env.DEMO_MFA_SECRET, "DEMO_PASSWORD and DEMO_MFA_SECRET must be set; seed the demo data to run signed-in journeys.");

const base = "/dashboard/tinkerspace";
// Dashboard pages stream, so a page that isn't there answers 200 with the not-found page rather than a 404 status.
const notFoundShown = (page: Page) => expect(page.getByRole("heading", { name: "We couldn’t find that page" })).toBeVisible();

async function reportIssue(page: Page, title: string) {
  await page.goto(`${base}/issues`);
  await page.getByRole("combobox", { name: "Space", exact: true }).filter({ visible: true }).click();
  await page.getByRole("option", { name: "Meeting room", exact: true }).filter({ visible: true }).click();
  await page.getByLabel("What is wrong", { exact: true }).filter({ visible: true }).fill(title);
  await page.getByRole("combobox", { name: "How urgent", exact: true }).filter({ visible: true }).click();
  await page.getByRole("option", { name: "High", exact: true }).filter({ visible: true }).click();
  await page.getByRole("button", { name: "Report the issue", exact: true }).filter({ visible: true }).click();
  await expect(page.getByText("Thanks, it's reported")).toBeVisible();
  await page.reload();
  await page.getByRole("link", { name: title }).filter({ visible: true }).click();
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
}

async function askTechnicians(page: Page, names: string[]) {
  for (const name of names) await page.getByRole("checkbox", { name: new RegExp(`^${name}`) }).filter({ visible: true }).click();
  await page.getByRole("button", { name: "Send the request", exact: true }).filter({ visible: true }).click();
  await expect(page.getByText("Who was asked")).toBeVisible();
}

test("a team technician takes a repair the manager asked for, and the manager verifies and pays", async ({ page, browser }) => {
  const title = `Projector flickers ${Date.now()}`;
  const utr = `UTR-E2E-${Date.now()}`;
  await signIn(page, "manager@demo.test");
  await reportIssue(page, title);
  await askTechnicians(page, ["Arjun Pillai", "Meera AV Repairs"]);
  const issueUrl = page.url();

  const tech = await browser.newPage();
  await signIn(tech, "tech@demo.test");
  await tech.goto(`${base}`);
  await expect(tech).toHaveURL(/\/issues$/);
  await expect(tech.getByRole("heading", { name: "My repairs", level: 1 })).toBeVisible();
  await tech.goto(issueUrl);
  await tech.getByRole("button", { name: "Accept the repair", exact: true }).filter({ visible: true }).click();
  await tech.getByLabel("What you did", { exact: true }).filter({ visible: true }).fill("Replaced the HDMI cable");
  await tech.getByLabel("What you ask for the work (INR)", { exact: true }).filter({ visible: true }).fill("750");
  await tech.getByRole("button", { name: "Mark as fixed", exact: true }).filter({ visible: true }).click();
  await expect(tech.getByText("Fixed, to verify")).toBeVisible();
  // A technician sees no finance and no bookings.
  await tech.goto(`${base}/finance`);
  await notFoundShown(tech);
  await tech.close();

  await page.reload();
  await page.getByRole("button", { name: "Verify and close", exact: true }).filter({ visible: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Verify and close", exact: true }).filter({ visible: true }).click();
  await expect(page.getByText("Closed", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).filter({ visible: true }).click();
  await expect(page.getByText("Record a payout")).toBeVisible();
  await page.getByLabel("Reference (UTR, UPI or cheque number; not needed for cash)", { exact: true }).fill(utr);
  await page.getByRole("button", { name: "Record the payout", exact: true }).filter({ visible: true }).click();
  await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();

  await page.goto(`${base}/finance?period=month`);
  await expect(page.getByRole("heading", { name: "Finance", level: 1 })).toBeVisible();
  await expect(page.getByText(utr).filter({ visible: true }).first()).toBeVisible();
  const xlsx = await page.request.get(`/api/exports/finance/tinkerspace?period=month&format=xlsx`);
  expect(xlsx.ok()).toBe(true);
  expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");
});

test("an outside technician answers and records the work through their link", async ({ page }) => {
  test.skip(!process.env.DATABASE_URL, "Needs the database to stand in for the emailed link.");
  const title = `AC drips ${Date.now()}`;
  await signIn(page, "manager@demo.test");
  await reportIssue(page, title);
  await askTechnicians(page, ["Ravi Cooling Services"]);
  // The link only ever exists in the email: give the request a known one, as the email would carry.
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const token = randomBytes(32).toString("base64url");
  try {
    const issue = await prisma.spaceIssue.findFirstOrThrow({ where: { title } });
    await prisma.repairRequest.updateMany({ where: { issueId: issue.id }, data: { tokenHash: createHash("sha256").update(token).digest("hex") } });
  } finally {
    await prisma.$disconnect();
  }
  const link = await page.context().browser()!.newPage();
  await link.goto(`/repair/${token}`);
  await expect(link.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  await link.getByRole("button", { name: "Accept the repair", exact: true }).filter({ visible: true }).click();
  await link.getByLabel("What you did", { exact: true }).filter({ visible: true }).fill("Cleared the drain pipe");
  await link.getByRole("button", { name: "Mark as fixed", exact: true }).filter({ visible: true }).click();
  await expect(link.getByText("Thank you")).toBeVisible();
  await link.goto("/repair/not-a-real-token-at-all-not-a-real-token-xx");
  await notFoundShown(link);
  await link.close();
});

test("front desk sees no finance pages or exports", async ({ page }) => {
  await signIn(page, "front@demo.test");
  for (const path of [`${base}/finance`, `${base}/payments`]) {
    await page.goto(path);
    await notFoundShown(page);
  }
  for (const path of ["/api/exports/finance/tinkerspace", "/api/exports/repairs/tinkerspace", "/api/exports/payments/tinkerspace"]) expect((await page.request.get(path)).status()).toBe(404);
  await page.goto(`${base}/issues`);
  await expect(page.getByRole("heading", { name: "Issues", level: 1 })).toBeVisible();
});
