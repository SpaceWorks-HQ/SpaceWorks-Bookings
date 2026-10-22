import { describe, expect, it } from "vitest";
import { apportion, paymentHealth, revenueBy, revenueByFeeKind, revenueSeries, revenueSummary } from "@/lib/reports/finance/revenue";
import { EMPTY_FINANCE_ROWS, type FinanceRows } from "@/lib/reports/finance/types";
import { csvAmount, formatTotals, subtractTotals } from "@/lib/reports/money";
import { periodBuckets, resolvePeriod } from "@/lib/reports/period";
import { at, line, payment, refund } from "../helpers/financeFixtures";

const rows = (patch: Partial<FinanceRows>): FinanceRows => ({ ...EMPTY_FINANCE_ROWS, ...patch });
const MAY = { from: at("2026-05-01"), to: at("2026-06-01") };
const JUNE = { from: at("2026-06-01"), to: at("2026-07-01") };

describe("collected (B5)", () => {
  const data = rows({
    payments: [
      payment("a", { amountMinor: 120_000 }),
      payment("b", { currency: "USD", amountMinor: 2_500, provider: "STRIPE" }),
      payment("c", { status: "WAIVED", paidAt: null }),
      payment("d", { status: "PENDING", paidAt: null }),
      payment("e", { paidAt: at("2026-06-05"), createdAt: at("2026-05-30") }),
    ],
    refunds: [refund("r1", "a", 20_000), refund("r2", "a", 5_000, { status: "PENDING", processedAt: null })],
  });

  it("counts PAID by paidAt only, and never adds currencies", () => {
    const may = revenueSummary(data, MAY, "INR");
    expect(may.gross).toEqual([{ currency: "INR", minor: 120_000 }, { currency: "USD", minor: 2_500 }]);
    expect(may.refunds).toEqual([]);
    expect(may.payments).toBe(2);
  });

  it("nets refunds by the date they were processed, not the payment's date", () => {
    const june = revenueSummary(data, JUNE, "INR");
    expect(june.gross).toEqual([{ currency: "INR", minor: 100_000 }]);
    expect(june.refunds).toEqual([{ currency: "INR", minor: 20_000 }]);
    expect(june.net).toEqual([{ currency: "INR", minor: 80_000 }]);
  });

  it("puts the organisation's currency first, then the rest alphabetically", () => {
    const list = subtractTotals([{ currency: "USD", minor: 5 }, { currency: "AED", minor: 1 }], [], "USD");
    expect(list.map((entry) => entry.currency)).toEqual(["USD", "AED"]);
    expect(formatTotals([{ currency: "INR", minor: 120_050 }, { currency: "USD", minor: 2_500 }])).toBe("₹1,200.50 · $25.00");
    expect(csvAmount(1_250, "OMR")).toBe("1.250");
    expect(csvAmount(500, "JPY")).toBe("500");
  });

  it("splits by provider and month with refunds against their payment's group", () => {
    expect(revenueBy(data, { from: MAY.from, to: JUNE.to }, "provider", "INR").find((row) => row.key === "RAZORPAY")!.totals).toEqual([{ currency: "INR", minor: 200_000 }]);
    const buckets = periodBuckets(resolvePeriod({ period: "custom", from: "2026-05-01", to: "2026-06-30" }, { timezone: "Asia/Kolkata", financialYearStartMonth: 4 }, at("2026-10-01")), "Asia/Kolkata");
    expect(revenueSeries(data, buckets, "INR").map((point) => point.net)).toEqual([[{ currency: "INR", minor: 120_000 }, { currency: "USD", minor: 2_500 }], [{ currency: "INR", minor: 80_000 }]]);
  });

  it("apportions a refund over fee kinds in whole minor units that add up exactly", () => {
    expect(apportion(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(apportion(20_000, [100_000, 20_000]).reduce((a, b) => a + b, 0)).toBe(20_000);
    const fees = revenueByFeeKind(rows({ payments: [payment("a", { amountMinor: 120_000 })], lines: [line("a", "BOOKING", 100_000), line("a", "ADD_ON", 20_000)], refunds: [refund("r", "a", 12_000, { processedAt: at("2026-05-20") })] }), MAY, "INR");
    expect(Object.fromEntries(fees.map((row) => [row.key, row.totals[0].minor]))).toEqual({ BOOKING: 90_000, ADD_ON: 18_000 });
  });

  it("reports failed online payments, waivers and pending refunds", () => {
    const health = paymentHealth(rows({ payments: [payment("a"), payment("b", { status: "FAILED", paidAt: null }), payment("c", { provider: "OFFLINE", status: "FAILED", paidAt: null }), payment("w", { status: "WAIVED", paidAt: null, amountMinor: 50_000 })], refunds: [refund("r", "a", 1, { status: "PENDING" })] }), MAY, "INR");
    expect(health).toMatchObject({ failed: 1, onlineAttempts: 2, failedRate: 0.5, waived: 1, waivedTotals: [{ currency: "INR", minor: 50_000 }], pendingRefunds: 1 });
  });
});
