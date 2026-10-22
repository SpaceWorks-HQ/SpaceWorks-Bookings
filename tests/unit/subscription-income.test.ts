import { describe, expect, it } from "vitest";
import { subscriptionIncome } from "@/lib/reports/finance/subscriptionIncome";
import type { FinancePayment, FinancePaymentLine } from "@/lib/reports/finance/types";

const year = { from: new Date("2026-04-01T00:00:00Z"), to: new Date("2027-04-01T00:00:00Z") };
const payment = (id: string, paidAt: string, amount: number, termId: string | null = id): FinancePayment => ({
  id, memberId: "m", termId, unitId: null, planId: "p", status: "PAID", provider: "OFFLINE", method: "cash", currency: "INR",
  amountMinor: amount, createdAt: new Date(paidAt), paidAt: new Date(paidAt), flagged: false, recordedById: null, confirmedById: null,
});
const fee = (paymentId: string, taxable: number, kind: FinancePaymentLine["kind"] = "TERM_FEE"): FinancePaymentLine => ({ paymentId, kind, currency: "INR", amountMinor: taxable, taxableMinor: taxable, cgstMinor: 0, sgstMinor: 0, igstMinor: 0, otherTaxMinor: 0 });
const term = (termId: string, start: string, end: string) => ({ termId, startsAt: new Date(start), endsAt: new Date(end) });

describe("subscription income by financial year", () => {
  it("defers the part of a fee received this year that covers next year", () => {
    const [row] = subscriptionIncome({ payments: [payment("a", "2026-10-01", 120_000)], lines: [fee("a", 120_000)], refunds: [] }, [term("a", "2026-10-01T00:00:00Z", "2027-10-01T00:00:00Z")], year);
    expect(row.received).toBe(120_000);
    expect(row.earned + row.advanceClosing).toBe(120_000);
    expect(row.advanceClosing).toBeGreaterThan(row.earned - 1);
  });

  it("brings in last year's advance and records fees paid late as arrears", () => {
    const result = subscriptionIncome(
      { payments: [payment("old", "2026-03-15", 100_000), payment("late", "2027-05-01", 100_000)], lines: [fee("old", 100_000), fee("late", 100_000)], refunds: [] },
      [term("old", "2026-04-01T00:00:00Z", "2027-04-01T00:00:00Z"), term("late", "2026-04-01T00:00:00Z", "2027-04-01T00:00:00Z")],
      year,
    );
    const [row] = result;
    expect(row.advanceOpening).toBe(100_000);
    expect(row.arrearsClosing).toBe(100_000);
    expect(row.earned).toBe(200_000);
  });

  it("always reconciles: earned = received + advance in − advance out + arrears out − arrears in", () => {
    const payments = [payment("a", "2026-02-01", 90_000), payment("b", "2026-06-15", 70_001), payment("c", "2027-06-01", 50_003)];
    const terms = [term("a", "2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z"), term("b", "2026-06-15T00:00:00Z", "2027-06-15T00:00:00Z"), term("c", "2026-03-01T00:00:00Z", "2027-03-01T00:00:00Z")];
    const [row] = subscriptionIncome({ payments, lines: payments.map((p) => fee(p.id, p.amountMinor)), refunds: [] }, terms, year);
    expect(row.earned).toBe(row.received + row.advanceOpening - row.advanceClosing + row.arrearsClosing - row.arrearsOpening);
  });

  it("takes joining fees and lifetime memberships as income on receipt, net of refunds", () => {
    const [row] = subscriptionIncome(
      { payments: [payment("j", "2026-07-01", 150_000), payment("life", "2026-08-01", 500_000)], lines: [fee("j", 100_000), fee("j", 50_000, "JOINING_FEE"), fee("life", 500_000)], refunds: [{ id: "r", paymentId: "life", currency: "INR", amountMinor: 250_000, status: "PROCESSED", createdAt: new Date("2026-09-01"), processedAt: new Date("2026-09-01") }] },
      [term("j", "2026-07-01T00:00:00Z", "2027-07-01T00:00:00Z"), { termId: "life", startsAt: new Date("2026-08-01"), endsAt: null }],
      year,
    );
    expect(row.receivedOnReceipt).toBe(50_000 + 250_000);
  });
});
