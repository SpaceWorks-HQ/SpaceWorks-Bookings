import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { allocateRefund, RefundAllocationError } = await import("@/lib/bookings/money/allocate");
const { paymentPlan } = await import("@/lib/bookings/money/start");
const { latestReminderPoint } = await import("@/lib/bookings/money/jobs");

const day = (n: number) => new Date(Date.UTC(2030, 0, n));

describe("allocateRefund", () => {
  const sources = [
    { paymentId: "cash", paidAt: day(3), refundableMinor: 40_000, gatewayUsable: false },
    { paymentId: "old", paidAt: day(1), refundableMinor: 30_000, gatewayUsable: true },
    { paymentId: "new", paidAt: day(2), refundableMinor: 30_000, gatewayUsable: true },
  ];

  it("takes gateway payments first, newest first, then offline ones", () => {
    expect(allocateRefund(70_000, sources)).toEqual([
      { paymentId: "new", amountMinor: 30_000, offlineRequired: false },
      { paymentId: "old", amountMinor: 30_000, offlineRequired: false },
      { paymentId: "cash", amountMinor: 10_000, offlineRequired: true },
    ]);
  });

  it("stops as soon as the amount is covered and skips spent payments", () => {
    expect(allocateRefund(5_000, [{ ...sources[1], refundableMinor: 0 }, sources[2]])).toEqual([{ paymentId: "new", amountMinor: 5_000, offlineRequired: false }]);
  });

  it("refuses more than is left and ignores nothing to refund", () => {
    expect(() => allocateRefund(100_001, sources)).toThrow(RefundAllocationError);
    expect(allocateRefund(0, sources)).toEqual([]);
    expect(allocateRefund(-5, sources)).toEqual([]);
  });
});

describe("paymentPlan", () => {
  const booking = { status: "HELD" as const, awaitingPayment: true, chargeMode: "DEPOSIT" as const, chargeMinor: 100_000, depositMinor: 30_000, paidMinor: 0, refundedMinor: 0, writtenOffAt: null };

  it("asks for the deposit on a held deposit booking, or everything when asked", () => {
    expect(paymentPlan(booking)).toEqual({ amountMinor: 30_000, purpose: "DEPOSIT" });
    expect(paymentPlan(booking, { full: true })).toEqual({ amountMinor: 100_000, purpose: "FULL" });
  });

  it("asks for the balance, or the difference after a dearer reschedule", () => {
    const confirmed = { ...booking, status: "CONFIRMED" as const, awaitingPayment: false, paidMinor: 30_000 };
    expect(paymentPlan(confirmed)).toEqual({ amountMinor: 70_000, purpose: "BALANCE" });
    expect(paymentPlan(confirmed, { rescheduledSincePaid: true })).toEqual({ amountMinor: 70_000, purpose: "DIFFERENCE" });
  });

  it("has nothing to take for requests, paid, written-off or ended bookings", () => {
    expect(paymentPlan({ ...booking, status: "REQUESTED" })).toBeNull();
    expect(paymentPlan({ ...booking, status: "CONFIRMED", paidMinor: 100_000 })).toBeNull();
    expect(paymentPlan({ ...booking, writtenOffAt: day(1) })).toBeNull();
    expect(paymentPlan({ ...booking, status: "CANCELLED" })).toBeNull();
    expect(paymentPlan({ ...booking, awaitingPayment: false })).toBeNull();
  });
});

describe("latestReminderPoint", () => {
  const due = new Date("2030-01-10T10:00:00Z");
  it("finds the latest reminder before the due date that has passed", () => {
    expect(latestReminderPoint(due, [48, 2], "before", new Date("2030-01-08T09:00:00Z"))).toBeNull();
    expect(latestReminderPoint(due, [48, 2], "before", new Date("2030-01-08T11:00:00Z"))).toEqual(new Date("2030-01-08T10:00:00Z"));
    expect(latestReminderPoint(due, [48, 2], "before", new Date("2030-01-10T09:00:00Z"))).toEqual(new Date("2030-01-10T08:00:00Z"));
  });

  it("finds overdue points after the due date", () => {
    expect(latestReminderPoint(due, [24], "after", new Date("2030-01-10T11:00:00Z"))).toBeNull();
    expect(latestReminderPoint(due, [1, 24], "after", new Date("2030-01-11T11:00:00Z"))).toEqual(new Date("2030-01-11T10:00:00Z"));
  });
});
