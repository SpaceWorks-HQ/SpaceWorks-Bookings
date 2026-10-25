import { describe, expect, it } from "vitest";
import { balanceDue, chargeFor, keptFee, paymentState, refundDue, tierRefundBps, type ObligationInput, type ObligationOccurrence, type PaymentStateInput } from "@/lib/bookings/obligation";

const TIERS = [
  { minHoursBefore: 48, refundBps: 10_000 },
  { minHoursBefore: 24, refundBps: 5000 },
  { minHoursBefore: 0, refundBps: 0 },
];
const START = new Date("2026-11-10T10:00:00Z");
const hoursBefore = (hours: number) => new Date(START.getTime() - hours * 3_600_000);
const policy = { depositRefundable: true, chargeLateCancelWhenUnpaid: false, noShowCharge: "FULL" as const };
const row = (status: ObligationOccurrence["status"], priceMinor = 1000, keptFeeMinor = 0): ObligationOccurrence => ({ status, priceMinor, keptFeeMinor });
const charge = (over: Partial<ObligationInput>) => chargeFor({ occurrences: [], depositMinor: 0, paidMinor: 0, refundedMinor: 0, policy, ...over });

describe("refund tiers", () => {
  it("pick the first tier whose hours have been reached", () => {
    expect(tierRefundBps(TIERS, 72)).toBe(10_000);
    expect(tierRefundBps(TIERS, 48)).toBe(10_000);
    expect(tierRefundBps(TIERS, 47.9)).toBe(5000);
    expect(tierRefundBps(TIERS, 24)).toBe(5000);
    expect(tierRefundBps(TIERS, 3)).toBe(0);
    expect(tierRefundBps(TIERS, -2)).toBe(0);
    expect(tierRefundBps([], -2)).toBe(10_000);
    expect(tierRefundBps([{ minHoursBefore: 24, refundBps: 5000 }], 2)).toBe(0);
  });

  it("keep the unrefunded share as a fee, half up", () => {
    expect(keptFee(1000, TIERS, START, hoursBefore(72))).toBe(0);
    expect(keptFee(1001, TIERS, START, hoursBefore(30))).toBe(500);
    expect(keptFee(1000, TIERS, START, hoursBefore(1))).toBe(1000);
    expect(keptFee(0, TIERS, START, hoursBefore(1))).toBe(0);
  });
});

describe("chargeFor", () => {
  it("charges live occurrences in full", () => {
    expect(charge({ occurrences: [row("SCHEDULED"), row("CHECKED_IN"), row("COMPLETED")] })).toBe(3000);
  });

  it("keeps late-cancel fees only out of money already paid by default", () => {
    const occurrences = [row("SCHEDULED"), row("CANCELLED", 1000, 500)];
    expect(charge({ occurrences })).toBe(1000);
    expect(charge({ occurrences, paidMinor: 2000 })).toBe(1500);
    expect(charge({ occurrences, paidMinor: 1200 })).toBe(1200);
    expect(charge({ occurrences, policy: { ...policy, chargeLateCancelWhenUnpaid: true } })).toBe(1500);
  });

  it("keeps nothing after a venue cancel, deposit included", () => {
    const occurrences = [row("CANCELLED", 1000, 1000)];
    expect(charge({ occurrences, paidMinor: 1000, venueCancelled: true, depositMinor: 500, policy: { ...policy, depositRefundable: false } })).toBe(0);
  });

  it("treats a non-refundable deposit as a floor", () => {
    const occurrences = [row("CANCELLED", 1000, 0)];
    const strict = { ...policy, depositRefundable: false };
    expect(charge({ occurrences, depositMinor: 300, paidMinor: 1000, policy: strict })).toBe(300);
    expect(charge({ occurrences, depositMinor: 300, paidMinor: 200, policy: strict })).toBe(200);
    expect(charge({ occurrences, depositMinor: 300, paidMinor: 1000 })).toBe(0);
  });

  it("charges no-shows in full, or only from money paid under NONE", () => {
    expect(charge({ occurrences: [row("NO_SHOW")] })).toBe(1000);
    const waived = { ...policy, noShowCharge: "NONE" as const };
    expect(charge({ occurrences: [row("NO_SHOW")], policy: waived })).toBe(0);
    expect(charge({ occurrences: [row("NO_SHOW")], policy: waived, paidMinor: 400 })).toBe(400);
  });

  it("counts fees kept from shortening a live occurrence", () => {
    expect(charge({ occurrences: [row("SCHEDULED", 600, 200)], paidMinor: 1000 })).toBe(800);
    expect(charge({ occurrences: [row("SCHEDULED", 600, 200)], policy: { ...policy, chargeLateCancelWhenUnpaid: true } })).toBe(800);
  });

  it("subtracts refunds from what was paid", () => {
    expect(charge({ occurrences: [row("CANCELLED", 1000, 500)], paidMinor: 1000, refundedMinor: 800 })).toBe(200);
  });
});

describe("money due", () => {
  it("is a refund when net paid exceeds the charge, else a balance", () => {
    expect(refundDue(500, { paidMinor: 1000, refundedMinor: 0 })).toBe(500);
    expect(refundDue(500, { paidMinor: 1000, refundedMinor: 500 })).toBe(0);
    expect(balanceDue(1500, { paidMinor: 1000, refundedMinor: 0 })).toBe(500);
    expect(balanceDue(500, { paidMinor: 1000, refundedMinor: 0 })).toBe(0);
  });
});

describe("paymentState", () => {
  const NOW = new Date("2026-11-05T00:00:00Z");
  const state = (over: Partial<PaymentStateInput>) => paymentState({ status: "CONFIRMED", totalMinor: 1000, chargeMinor: 1000, paidMinor: 0, refundedMinor: 0, paymentDueAt: null, writtenOffAt: null, ...over }, NOW);

  it("covers every state", () => {
    expect(state({ totalMinor: 0, chargeMinor: 0 })).toBe("NOT_REQUIRED");
    expect(state({})).toBe("UNPAID");
    expect(state({ paidMinor: 400 })).toBe("PARTIALLY_PAID");
    expect(state({ paidMinor: 1000 })).toBe("PAID");
    expect(state({ paymentDueAt: new Date("2026-11-04T00:00:00Z") })).toBe("OVERDUE");
    expect(state({ paidMinor: 400, paymentDueAt: new Date("2026-11-04T00:00:00Z") })).toBe("OVERDUE");
    expect(state({ paymentDueAt: new Date("2026-11-06T00:00:00Z") })).toBe("UNPAID");
    expect(state({ status: "CANCELLED", chargeMinor: 0 })).toBe("VOID");
    expect(state({ writtenOffAt: NOW })).toBe("WRITTEN_OFF");
    expect(state({ chargeMinor: 300, paidMinor: 1000 })).toBe("REFUND_DUE");
    expect(state({ chargeMinor: 0, paidMinor: 1000, refundedMinor: 1000 })).toBe("REFUNDED");
    expect(state({ chargeMinor: 300, paidMinor: 1000, refundedMinor: 700 })).toBe("PAID");
  });
});
