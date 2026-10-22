import { describe, expect, it } from "vitest";
import { bucketIndex, fyLabel, periodBuckets, resolvePeriod } from "@/lib/reports/period";
import { contactFor, maskEmail, maskPhone } from "@/lib/reports/mask";
import { compactNumber, formatTick, formatValue, niceTicks, signed } from "@/lib/reports/chartScale";

const KOLKATA = { timezone: "Asia/Kolkata", financialYearStartMonth: 4 };

describe("financial-year periods in the organisation's timezone", () => {
  it("starts FY 2026-27 at midnight IST on 1 April and stops at the end of today", () => {
    const period = resolvePeriod({}, KOLKATA, new Date("2026-10-20T06:30:00Z"));
    expect(period.label).toBe("FY 2026-27");
    expect(period.from.toISOString()).toBe("2026-03-31T18:30:00.000Z");
    expect(period.to.toISOString()).toBe("2026-10-20T18:30:00.000Z");
    expect(period.previous.to.toISOString()).toBe(period.from.toISOString());
  });

  it("puts 00:30 IST on 1 April in the new year, though it is still 31 March in UTC", () => {
    const now = new Date("2026-03-31T19:00:00Z");
    expect(resolvePeriod({}, KOLKATA, now).label).toBe("FY 2026-27");
    expect(resolvePeriod({}, KOLKATA, new Date("2026-03-31T18:00:00Z")).label).toBe("FY 2025-26");
  });

  it("labels last year and calendar-year organisations", () => {
    expect(resolvePeriod({ period: "last-fy" }, KOLKATA, new Date("2026-10-20T06:30:00Z")).label).toBe("FY 2025-26");
    expect(fyLabel({ year: 2026, month: 6, day: 1 }, 1)).toBe("FY 2026");
    expect(resolvePeriod({}, { timezone: "Europe/London", financialYearStartMonth: 1 }, new Date("2026-10-20T06:30:00Z")).from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("accepts a custom range in order and falls back to the year otherwise", () => {
    const custom = resolvePeriod({ period: "custom", from: "2026-05-01", to: "2026-05-31" }, KOLKATA, new Date("2026-10-20T06:30:00Z"));
    expect(custom.label).toBe("1 May 2026 to 31 May 2026");
    expect(custom.to.toISOString()).toBe("2026-05-31T18:30:00.000Z");
    expect(resolvePeriod({ period: "custom", from: "2026-06-01", to: "2026-05-01" }, KOLKATA, new Date("2026-10-20T06:30:00Z")).preset).toBe("fy");
    expect(resolvePeriod({ period: "custom", from: "2026-02-30", to: "2026-05-01" }, KOLKATA, new Date("2026-10-20T06:30:00Z")).preset).toBe("fy");
  });

  it("buckets by day up to 45 days and by month beyond, clipped to the period", () => {
    const fy = resolvePeriod({}, KOLKATA, new Date("2026-10-20T06:30:00Z"));
    const months = periodBuckets(fy, "Asia/Kolkata");
    expect(months.map((b) => b.label)).toEqual(["Apr 26", "May 26", "Jun 26", "Jul 26", "Aug 26", "Sep 26", "Oct 26"]);
    expect(months.at(-1)!.to.toISOString()).toBe(fy.to.toISOString());
    expect(bucketIndex(months, new Date("2026-04-30T18:29:59Z"))).toBe(0);
    expect(bucketIndex(months, new Date("2026-04-30T18:30:00Z"))).toBe(1);
    expect(periodBuckets(resolvePeriod({ period: "30d" }, KOLKATA, new Date("2026-10-20T06:30:00Z")), "Asia/Kolkata")).toHaveLength(30);
  });
});

describe("contact masking for viewers", () => {
  it("keeps enough to tell people apart and nothing to reach them", () => {
    expect(maskEmail("shaan@example.com")).toBe("s•••@e•••.com");
    expect(maskPhone("+91 98470 12345")).toBe("•••• 45");
    expect(contactFor(false, { email: "a@b.in", phone: null })).toEqual({ email: "a•••@b•••.in", phone: "" });
    expect(contactFor(true, { email: "a@b.in", phone: "1" })).toEqual({ email: "a@b.in", phone: "1" });
  });
});

describe("chart helpers", () => {
  it("rounds axes and formats values", () => {
    expect(niceTicks(215)).toEqual([0, 100, 200, 300]);
    expect(niceTicks(1, 4)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(compactNumber(12_900)).toBe("13K");
    expect(formatValue(null, "percent")).toBe("—");
    expect(formatValue(0.756, "percent")).toBe("76%");
    expect(formatValue(120_000, "money:INR")).toBe("₹1,200.00");
    expect(formatTick(250_000, "money:INR")).toBe("2.5K");
    expect(signed(-3)).toBe("−3");
    expect(signed(0.11, "percent")).toBe("+11 pts");
  });
});
