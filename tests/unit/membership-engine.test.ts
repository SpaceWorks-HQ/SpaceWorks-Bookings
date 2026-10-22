import { describe, expect, it } from "vitest";
import {
  addMonths,
  canRenewNow,
  financialYearLabel,
  graceUntil,
  lastValidDay,
  localDate,
  renewalStartDay,
  startOfLocalDay,
  termWindow,
  type PlanPeriodRules,
} from "@/lib/membership/periods";
import { canTransition, chargesJoiningFee, deriveStatus, statusAt, type TermLike } from "@/lib/membership/lifecycle";
import { formatMoney, parseAmount, toInputValue, totalsByCurrency, sumMinor } from "@/lib/money/currencies";

const IST = "Asia/Kolkata";
const plan = (overrides: Partial<PlanPeriodRules> = {}): PlanPeriodRules => ({
  durationType: "ORG_YEAR",
  durationMonths: null,
  fixedEndDate: null,
  graceDays: 15,
  renewalWindowDays: 30,
  lateRenewalBackdate: true,
  ...overrides,
});

describe("membership periods", () => {
  it("starts each day at local midnight, stored as UTC", () => {
    expect(startOfLocalDay({ year: 2026, month: 4, day: 1 }, IST).toISOString()).toBe("2026-03-31T18:30:00.000Z");
    expect(startOfLocalDay({ year: 2026, month: 4, day: 1 }, "UTC").toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  it("handles a daylight-saving zone", () => {
    // London is UTC+1 in July.
    expect(startOfLocalDay({ year: 2026, month: 7, day: 1 }, "Europe/London").toISOString()).toBe("2026-06-30T23:00:00.000Z");
  });

  it("ends an organisation-year plan at the next financial year", () => {
    const window = termWindow(plan(), { year: 2026, month: 6, day: 15 }, IST, 4)!;
    expect(lastValidDay(window.endsAt!, IST)).toEqual({ year: 2027, month: 3, day: 31 });
    const january = termWindow(plan(), { year: 2027, month: 1, day: 10 }, IST, 4)!;
    expect(lastValidDay(january.endsAt!, IST)).toEqual({ year: 2027, month: 3, day: 31 });
  });

  it("runs a rolling plan for whole months, clamping short months", () => {
    expect(addMonths({ year: 2026, month: 1, day: 31 }, 1)).toEqual({ year: 2026, month: 2, day: 28 });
    const window = termWindow(plan({ durationType: "ROLLING", durationMonths: 6 }), { year: 2026, month: 8, day: 31 }, IST, 4)!;
    expect(localDate(window.endsAt!, IST)).toEqual({ year: 2027, month: 2, day: 28 });
  });

  it("refuses a fixed-end plan that has already ended, and has no end for lifetime", () => {
    const fixed = plan({ durationType: "FIXED_END", fixedEndDate: new Date(Date.UTC(2026, 11, 31)) });
    expect(lastValidDay(termWindow(fixed, { year: 2026, month: 5, day: 1 }, IST, 4)!.endsAt!, IST)).toEqual({ year: 2026, month: 12, day: 31 });
    expect(termWindow(fixed, { year: 2027, month: 1, day: 2 }, IST, 4)).toBeNull();
    expect(termWindow(plan({ durationType: "LIFETIME" }), { year: 2026, month: 5, day: 1 }, IST, 4)!.endsAt).toBeNull();
  });

  it("adds grace in calendar days and labels financial years", () => {
    const end = startOfLocalDay({ year: 2027, month: 4, day: 1 }, IST);
    expect(localDate(graceUntil(end, 15, IST)!, IST)).toEqual({ year: 2027, month: 4, day: 16 });
    expect(graceUntil(end, 0, IST)).toEqual(end);
    expect(financialYearLabel({ year: 2027, month: 2, day: 1 }, 4)).toBe("2026-27");
    expect(financialYearLabel({ year: 2027, month: 2, day: 1 }, 1)).toBe("2027");
  });

  it("opens renewal 30 days before the end and closes it after grace", () => {
    const end = startOfLocalDay({ year: 2027, month: 4, day: 1 }, IST);
    const grace = graceUntil(end, 15, IST);
    expect(canRenewNow(end, grace, 30, new Date("2027-02-20T00:00:00Z"))).toBe(false);
    expect(canRenewNow(end, grace, 30, new Date("2027-03-10T00:00:00Z"))).toBe(true);
    expect(canRenewNow(end, grace, 30, new Date("2027-04-10T00:00:00Z"))).toBe(true);
    expect(canRenewNow(end, grace, 30, new Date("2027-04-20T00:00:00Z"))).toBe(false);
  });

  it("starts an early renewal at the old end, a late one backdated or today", () => {
    const previous = { endsAt: startOfLocalDay({ year: 2027, month: 4, day: 1 }, IST), graceUntil: startOfLocalDay({ year: 2027, month: 4, day: 16 }, IST) };
    expect(renewalStartDay(previous, plan(), new Date("2027-03-18T06:00:00Z"), IST)).toEqual({ year: 2027, month: 4, day: 1 });
    expect(renewalStartDay(previous, plan(), new Date("2027-04-08T06:00:00Z"), IST)).toEqual({ year: 2027, month: 4, day: 1 });
    expect(renewalStartDay(previous, plan({ lateRenewalBackdate: false }), new Date("2027-04-08T06:00:00Z"), IST)).toEqual({ year: 2027, month: 4, day: 8 });
    expect(renewalStartDay(previous, plan(), new Date("2027-05-02T06:00:00Z"), IST)).toEqual({ year: 2027, month: 5, day: 2 });
  });
});

const term = (overrides: Partial<TermLike>): TermLike => ({
  id: "t1",
  status: "ACTIVE",
  startsAt: new Date("2026-03-31T18:30:00Z"),
  endsAt: new Date("2027-03-31T18:30:00Z"),
  graceUntil: new Date("2027-04-15T18:30:00Z"),
  createdAt: new Date("2026-03-20T00:00:00Z"),
  ...overrides,
});

describe("membership status", () => {
  it("reads a term's status from the clock", () => {
    const t = term({});
    expect(statusAt(t, new Date("2026-03-01T00:00:00Z"))).toBe("UPCOMING");
    expect(statusAt(t, new Date("2026-08-01T00:00:00Z"))).toBe("ACTIVE");
    expect(statusAt(t, new Date("2027-04-05T00:00:00Z"))).toBe("GRACE");
    expect(statusAt(t, new Date("2027-05-01T00:00:00Z"))).toBe("LAPSED");
    expect(statusAt(t, new Date("2027-04-05T00:00:00Z"), true)).toBe("ENDED");
    expect(statusAt(term({ endsAt: null, graceUntil: null }), new Date("2090-01-01T00:00:00Z"))).toBe("ACTIVE");
  });

  it("expires an unpaid term after its due date", () => {
    const unpaid = term({ status: "PENDING_PAYMENT", startsAt: null, endsAt: null, graceUntil: null, paymentDueBy: new Date("2026-04-15T00:00:00Z") });
    expect(statusAt(unpaid, new Date("2026-04-10T00:00:00Z"))).toBe("PENDING_PAYMENT");
    expect(statusAt(unpaid, new Date("2026-04-16T00:00:00Z"))).toBe("EXPIRED");
  });

  it("derives standing across a renewal chain", () => {
    const first = term({ id: "a" });
    const renewal = term({ id: "b", kind: "RENEWAL", renewedFromId: "a", status: "UPCOMING", startsAt: first.endsAt, endsAt: new Date("2028-03-31T18:30:00Z"), graceUntil: new Date("2028-04-15T18:30:00Z"), createdAt: new Date("2027-03-18T00:00:00Z") });
    const march = deriveStatus([first, renewal], new Date("2027-03-20T00:00:00Z"));
    expect(march.status).toBe("ACTIVE");
    expect(march.current?.id).toBe("a");
    expect(march.upcoming?.id).toBe("b");
    const april = deriveStatus([first, renewal], new Date("2027-04-05T00:00:00Z"));
    expect(april.status).toBe("ACTIVE");
    expect(april.current?.id).toBe("b");
  });

  it("reports lapse, pending and no membership", () => {
    expect(deriveStatus([term({})], new Date("2027-06-01T00:00:00Z")).status).toBe("LAPSED");
    const pending = term({ id: "p", status: "PENDING_APPROVAL", startsAt: null, endsAt: null, graceUntil: null });
    expect(deriveStatus([pending], new Date()).status).toBe("PENDING_APPROVAL");
    expect(deriveStatus([], new Date()).status).toBe("NONE");
  });

  it("allows only the documented transitions", () => {
    expect(canTransition("approve", "PENDING_APPROVAL")).toBe(true);
    expect(canTransition("cancel", "ACTIVE")).toBe(false);
    expect(canTransition("revoke", "ACTIVE")).toBe(true);
    expect(canTransition("markPaid", "EXPIRED")).toBe(true);
    expect(canTransition("reinstate", "LAPSED")).toBe(false);
  });

  it("charges the joining fee by the plan's rejoin rule", () => {
    const now = new Date("2028-01-01T00:00:00Z");
    const lapsed = [{ status: "LAPSED" as const, endsAt: new Date("2027-04-01T00:00:00Z"), graceUntil: new Date("2027-04-16T00:00:00Z") }];
    expect(chargesJoiningFee("NEVER", [], now, null)).toBe(true);
    expect(chargesJoiningFee("NEVER", lapsed, now, null)).toBe(false);
    expect(chargesJoiningFee("EACH_JOIN", lapsed, now, null)).toBe(true);
    expect(chargesJoiningFee("AFTER_LAPSE", lapsed, now, 90)).toBe(true);
    expect(chargesJoiningFee("AFTER_LAPSE", lapsed, now, 365)).toBe(false);
    expect(chargesJoiningFee("ONCE", [{ status: "REJECTED", endsAt: null, graceUntil: null }], now, null)).toBe(true);
  });
});

describe("money in many currencies", () => {
  it("parses typed amounts into minor units without floating point", () => {
    expect(parseAmount("1,200", "INR")).toBe(120_000);
    expect(parseAmount("₹ 1,200.50", "INR")).toBe(120_050);
    expect(parseAmount("0.1", "USD")).toBe(10);
    expect(parseAmount("1.255", "INR")).toBeNull();
    expect(parseAmount("1.255", "OMR")).toBe(1_255);
    expect(parseAmount("1500", "JPY")).toBe(1_500);
    expect(parseAmount("1.5", "JPY")).toBeNull();
    expect(parseAmount("-5", "INR")).toBeNull();
    expect(parseAmount("abc", "INR")).toBeNull();
  });

  it("formats with each currency's own decimals and grouping", () => {
    expect(formatMoney(120_000, "INR")).toBe("₹1,200.00");
    expect(formatMoney(12_345_678_90, "INR")).toBe("₹1,23,45,678.90");
    expect(formatMoney(1_255, "OMR")).toMatch(/1\.255/);
    expect(formatMoney(1_500, "JPY")).toMatch(/1,500$/);
    expect(toInputValue(120_050, "INR")).toBe("1200.50");
    expect(toInputValue(1_500, "JPY")).toBe("1500");
  });

  it("never adds different currencies together", () => {
    expect(() => sumMinor([{ minor: 100, currency: "INR" }, { minor: 100, currency: "USD" }], "INR")).toThrow();
    expect(totalsByCurrency([{ minor: 5, currency: "USD" }, { minor: 100, currency: "INR" }, { minor: 50, currency: "INR" }], "INR")).toEqual([
      { currency: "INR", minor: 150 },
      { currency: "USD", minor: 5 },
    ]);
  });
});
