import { describe, expect, it } from "vitest";
import { resolveFinancialDate } from "@/lib/actions/financialDate";
import { payoutSchema, manualEntrySchema } from "@/lib/actions/repairInputs";

describe("financial calendar dates", () => {
  it.each([
    ["2026-10-30", "Asia/Kolkata", "2026-10-29T18:30:00.000Z"],
    ["2026-10-29", "America/Los_Angeles", "2026-10-29T07:00:00.000Z"],
    ["2026-10-30", "Asia/Kathmandu", "2026-10-29T18:15:00.000Z"],
    ["2026-10-29", "UTC", "2026-10-29T00:00:00.000Z"],
    ["2026-03-08", "America/New_York", "2026-03-08T05:00:00.000Z"],
    ["2026-11-01", "America/New_York", "2026-11-01T04:00:00.000Z"],
  ])("resolves %s at day start in %s", (day, timezone, instant) => {
    expect(resolveFinancialDate(day, timezone).toISOString()).toBe(instant);
  });

  it("accepts today's local day after UTC midnight diverges but keeps tomorrow future", () => {
    const now = new Date("2026-10-29T20:34:00Z").getTime();
    expect(resolveFinancialDate("2026-10-30", "Asia/Kolkata").getTime()).toBeLessThan(now);
    expect(resolveFinancialDate("2026-10-31", "Asia/Kolkata").getTime()).toBeGreaterThan(now + 60_000);
  });

  it("rejects calendar overflow instead of normalising an invalid day", () => {
    expect(() => resolveFinancialDate("2026-02-30", "Asia/Kolkata")).toThrow("Choose a valid date");
  });

  it("preserves date-only schema inputs while retaining explicit timestamp compatibility", () => {
    const scope = { makerspaceSlug: "tinkerspace", issueId: "issue", amountMinor: 75000, method: "CASH", note: "Repair" };
    const paid = payoutSchema.parse({ ...scope, paidAt: "2026-10-30" });
    expect(paid.paidAt).toBe("2026-10-30");
    const manual = manualEntrySchema.parse({ makerspaceSlug: "tinkerspace", amountMinor: 75000, method: "CASH", note: "Repair", direction: "OUT", category: "SUPPLIES", occurredAt: "2026-10-30" });
    expect(manual.occurredAt).toBe("2026-10-30");
    const timestamp = payoutSchema.parse({ ...scope, paidAt: "2026-10-29T20:30:00Z" }).paidAt;
    expect(resolveFinancialDate(timestamp, "Asia/Kolkata").toISOString()).toBe("2026-10-29T20:30:00.000Z");
  });
});
