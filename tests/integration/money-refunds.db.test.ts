import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { moneyBooking, moneyOf, payOnline, prisma, setupMoney, NOW, type MoneyFixture } from "./money-helpers";

const { GATEWAYS } = await import("@/lib/payments/config");
const { sendBookingRefunds } = await import("@/lib/bookings/money/send");
const { cancelBooking } = await import("@/lib/bookings/cancel");
const { rescheduleOccurrence } = await import("@/lib/bookings/reschedule");
const { checkIn, markNoShow } = await import("@/lib/bookings/checkin");
const { paymentState } = await import("@/lib/bookings/obligation");
const { paymentPlan } = await import("@/lib/bookings/money/start");
const staffMoney = await import("@/lib/bookings/money/staff");
const { at } = await import("./bookings-helpers");

const fixtures: MoneyFixture[] = [];
async function fixture(...args: Parameters<typeof setupMoney>) {
  const created = await setupMoney(...args);
  fixtures.push(created);
  return created;
}
const firstRow = async (bookingId: string) => prisma.bookingOccurrence.findFirstOrThrow({ where: { bookingId }, orderBy: { startsAt: "asc" } });

afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  for (const item of fixtures) await item.cleanup();
  await prisma.$disconnect();
});

describe("refunds on cancellation", () => {
  it("applies the policy tier for a customer cancel and keeps the fee", async () => {
    const f = await fixture({ chargeMode: "PAY_NOW" });
    await prisma.refundTier.createMany({ data: [{ makerspaceId: f.makerspaceId, minHoursBefore: 48, refundBps: 10_000 }, { makerspaceId: f.makerspaceId, minHoursBefore: 0, refundBps: 5_000 }] });
    const bookingId = await moneyBooking(f, [30, 32]);
    await payOnline(f, bookingId, 100_000);
    const result = await cancelBooking({ makerspaceId: f.makerspaceId, bookingId, actor: f.customer, kind: "CUSTOMER", now: NOW });
    expect(result.refundIds).toHaveLength(1);
    const { booking, refunds } = await moneyOf(bookingId);
    expect(booking.chargeMinor).toBe(50_000);
    expect(refunds).toMatchObject([{ kind: "POLICY", amountMinor: 50_000, status: "PENDING", offlineRequired: false }]);
    expect(paymentState(booking, NOW)).toBe("REFUND_DUE");
    vi.spyOn(GATEWAYS.RAZORPAY, "refund").mockResolvedValue({ gatewayRefundId: "rfnd_1", status: "processed" });
    await sendBookingRefunds(result.refundIds);
    const after = await moneyOf(bookingId);
    expect(after.booking).toMatchObject({ refundedMinor: 50_000 });
    expect(paymentState(after.booking, NOW)).toBe("PAID");
    const document = await prisma.taxDocument.findFirstOrThrow({ where: { refundId: result.refundIds[0] } });
    expect(document.kind).toBe("CREDIT_NOTE");
  });

  it("gives everything back when the venue cancels, tiers or not", async () => {
    const f = await fixture({ chargeMode: "PAY_NOW" });
    await prisma.refundTier.create({ data: { makerspaceId: f.makerspaceId, minHoursBefore: 0, refundBps: 0 } });
    const bookingId = await moneyBooking(f, [34, 36]);
    await payOnline(f, bookingId, 100_000);
    await cancelBooking({ makerspaceId: f.makerspaceId, bookingId, actor: f.owner, kind: "VENUE", reason: "Flooded", now: NOW });
    expect((await moneyOf(bookingId)).refunds).toMatchObject([{ kind: "VENUE", amountMinor: 100_000 }]);
  });

  it("keeps a non-refundable deposit and voids an unpaid pay-later balance", async () => {
    const f = await fixture({ chargeMode: "DEPOSIT", depositRefundable: false, depositPercentBps: 2500 });
    const bookingId = await moneyBooking(f, [38, 40]);
    const held = (await moneyOf(bookingId)).booking;
    expect(paymentPlan(held)).toEqual({ amountMinor: 25_000, purpose: "DEPOSIT" });
    await payOnline(f, bookingId, 25_000, { purpose: "DEPOSIT" });
    expect((await moneyOf(bookingId)).booking.status).toBe("CONFIRMED");
    await cancelBooking({ makerspaceId: f.makerspaceId, bookingId, actor: f.customer, kind: "CUSTOMER", now: NOW });
    const { booking, refunds } = await moneyOf(bookingId);
    expect(refunds).toHaveLength(0);
    expect(booking.chargeMinor).toBe(25_000);
    expect(paymentState(booking, NOW)).toBe("PAID");

    const later = await fixture({ chargeMode: "PAY_LATER" });
    const unpaid = await moneyBooking(later, [42, 44]);
    await cancelBooking({ makerspaceId: later.makerspaceId, bookingId: unpaid, actor: later.customer, kind: "CUSTOMER", now: NOW });
    expect(paymentState((await moneyOf(unpaid)).booking, NOW)).toBe("VOID");
  });
});

describe("reschedule and no-show", () => {
  it("refunds the difference for a cheaper time and asks for the difference for a dearer one", async () => {
    const f = await fixture({ chargeMode: "PAY_NOW" });
    const bookingId = await moneyBooking(f, [50, 54]);
    await payOnline(f, bookingId, 160_000);
    const row = await firstRow(bookingId);
    const cheaper = await rescheduleOccurrence({ makerspaceId: f.makerspaceId, bookingId, occurrenceId: row.id, start: at(50), end: at(52), actor: f.owner, now: NOW });
    expect(cheaper.refundIds).toHaveLength(1);
    expect((await moneyOf(bookingId)).refunds).toMatchObject([{ kind: "RESCHEDULE", amountMinor: 60_000 }]);
    vi.spyOn(GATEWAYS.RAZORPAY, "refund").mockResolvedValue({ gatewayRefundId: "rfnd_r", status: "processed" });
    await sendBookingRefunds(cheaper.refundIds);
    const dearer = await rescheduleOccurrence({ makerspaceId: f.makerspaceId, bookingId, occurrenceId: row.id, start: at(50), end: at(53), actor: f.owner, now: NOW });
    expect(dearer.balanceDueMinor).toBe(50_000);
    const { booking } = await moneyOf(bookingId);
    expect(booking.paymentDueAt).not.toBeNull();
    expect(paymentPlan(booking, { rescheduledSincePaid: true })).toEqual({ amountMinor: 50_000, purpose: "DIFFERENCE" });
  });

  it("keeps the money on a no-show under FULL and waives the balance under NONE", async () => {
    const full = await fixture({ chargeMode: "PAY_NOW", noShowCharge: "FULL" });
    const paid = await moneyBooking(full, [10, 12]);
    await payOnline(full, paid, 100_000);
    await markNoShow({ makerspaceId: full.makerspaceId, occurrenceId: (await firstRow(paid)).id, actor: full.owner, now: at(11) });
    expect((await moneyOf(paid)).refunds).toHaveLength(0);
    expect((await moneyOf(paid)).booking.chargeMinor).toBe(100_000);

    const none = await fixture({ chargeMode: "PAY_LATER", noShowCharge: "NONE" });
    const owed = await moneyBooking(none, [10, 12]);
    await markNoShow({ makerspaceId: none.makerspaceId, occurrenceId: (await firstRow(owed)).id, actor: none.owner, now: at(11) });
    const booking = (await moneyOf(owed)).booking;
    expect(booking.chargeMinor).toBe(0);
    expect(paymentState(booking, at(11))).toBe("VOID");
  });

  it("restores the charge when someone marked absent arrives while the slot is still held", async () => {
    const f = await fixture({ chargeMode: "PAY_LATER", noShowCharge: "NONE", noShowReleasesSlot: false });
    const owed = await moneyBooking(f, [10, 12]);
    const before = (await moneyOf(owed)).booking.chargeMinor;
    const row = await firstRow(owed);
    await markNoShow({ makerspaceId: f.makerspaceId, occurrenceId: row.id, actor: f.owner, now: at(11) });
    expect((await moneyOf(owed)).booking.chargeMinor).toBe(0);
    await checkIn({ makerspaceId: f.makerspaceId, occurrenceId: row.id, actor: f.owner, now: at(11.25) });
    expect((await moneyOf(owed)).booking.chargeMinor).toBe(before);
  });
});

describe("the team's refunds", () => {
  it("treats a refund beyond what is due as a concession, so nothing is owed again", async () => {
    const f = await fixture({ chargeMode: "PAY_NOW" });
    const bookingId = await moneyBooking(f, [60, 62]);
    await payOnline(f, bookingId, 100_000);
    await expect(staffMoney.refundBooking({ makerspaceId: f.makerspaceId, bookingId, actor: f.owner, amountMinor: 30_000, reason: "" })).rejects.toThrow(/reason/);
    const result = await staffMoney.refundBooking({ makerspaceId: f.makerspaceId, bookingId, actor: f.owner, amountMinor: 30_000, reason: "Air conditioning was broken" });
    expect(result.concessionMinor).toBe(30_000);
    vi.spyOn(GATEWAYS.RAZORPAY, "refund").mockResolvedValue({ gatewayRefundId: "rfnd_m", status: "processed" });
    await sendBookingRefunds(result.refundIds);
    const { booking, refunds } = await moneyOf(bookingId);
    expect(refunds).toMatchObject([{ kind: "MANUAL", amountMinor: 30_000, status: "PROCESSED" }]);
    expect(booking).toMatchObject({ chargeMinor: 70_000, concessionMinor: 30_000, refundedMinor: 30_000 });
    expect(paymentState(booking, NOW)).toBe("PAID");
    const frontDesk = await f.staff("FRONT_DESK");
    await expect(staffMoney.refundBooking({ makerspaceId: f.makerspaceId, bookingId, actor: frontDesk, amountMinor: 1, reason: "x" })).rejects.toThrow();
  });

  it("holds a failed refund until the team retries it or records it offline", async () => {
    const f = await fixture({ chargeMode: "PAY_NOW" });
    const bookingId = await moneyBooking(f, [64, 66]);
    await payOnline(f, bookingId, 100_000);
    const cancelled = await cancelBooking({ makerspaceId: f.makerspaceId, bookingId, actor: f.owner, kind: "VENUE", reason: "Closed", now: NOW });
    const { GatewayError } = await import("@/lib/payments/gateway");
    vi.spyOn(GATEWAYS.RAZORPAY, "refund").mockRejectedValueOnce(new GatewayError("refused", 400, false));
    await sendBookingRefunds(cancelled.refundIds);
    let money = await moneyOf(bookingId);
    expect(money.refunds).toMatchObject([{ status: "FAILED" }]);
    // A later change doesn't open a second refund while the failed one waits for a decision.
    await prisma.$transaction(async (tx) => (await import("@/lib/bookings/charge")).recomputeCharge(tx, bookingId));
    expect((await moneyOf(bookingId)).refunds).toHaveLength(1);
    const retried = await staffMoney.retryRefund({ makerspaceId: f.makerspaceId, bookingId, actor: f.owner, refundId: money.refunds[0].id });
    vi.spyOn(GATEWAYS.RAZORPAY, "refund").mockRejectedValueOnce(new GatewayError("refused again", 400, false));
    await sendBookingRefunds(retried.refundIds);
    money = await moneyOf(bookingId);
    expect(money.refunds.map((refund) => refund.status)).toEqual(["FAILED", "FAILED"]);
    const recorded = await staffMoney.recordOfflineRefund({ makerspaceId: f.makerspaceId, bookingId, actor: f.owner, refundId: money.refunds[1].id, method: "bank_transfer", reference: "UTR 1234" });
    money = await moneyOf(bookingId);
    expect(money.refunds.find((refund) => refund.id === recorded.refundId)).toMatchObject({ status: "PROCESSED", method: "bank_transfer", reference: "UTR 1234", retryOfId: money.refunds[1].id });
    expect(money.booking.refundedMinor).toBe(100_000);
    expect(paymentState(money.booking, NOW)).toBe("REFUNDED");
  });

  it("refunds offline payments by hand and splits a refund gateway-first", async () => {
    const f = await fixture({ chargeMode: "PAY_NOW" });
    const bookingId = await moneyBooking(f, [70, 72]);
    const desk = await staffMoney.recordBookingOfflinePayment({ makerspaceId: f.makerspaceId, bookingId, actor: f.owner, amountMinor: 40_000, method: "cash", now: NOW });
    expect(desk.settled).toBe(true);
    await payOnline(f, bookingId, 60_000, { purpose: "BALANCE" });
    const cancelled = await cancelBooking({ makerspaceId: f.makerspaceId, bookingId, actor: f.owner, kind: "VENUE", reason: "Closed", now: NOW });
    const refunds = (await moneyOf(bookingId)).refunds;
    expect(refunds.map((refund) => [refund.amountMinor, refund.offlineRequired])).toEqual([[60_000, false], [40_000, true]]);
    expect(new Set(refunds.map((refund) => refund.refundGroupId)).size).toBe(1);
    const send = vi.spyOn(GATEWAYS.RAZORPAY, "refund").mockResolvedValue({ gatewayRefundId: "rfnd_s", status: "processed" });
    await sendBookingRefunds(cancelled.refundIds);
    expect(send).toHaveBeenCalledOnce();
    const cash = refunds.find((refund) => refund.offlineRequired)!;
    await staffMoney.recordOfflineRefund({ makerspaceId: f.makerspaceId, bookingId, actor: f.owner, refundId: cash.id, method: "cash", reference: "Handed back at the desk" });
    expect((await moneyOf(bookingId)).booking.refundedMinor).toBe(100_000);
  });
});
