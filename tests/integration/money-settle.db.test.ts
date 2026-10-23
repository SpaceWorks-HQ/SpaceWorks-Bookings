import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { moneyBooking, moneyOf, payOnline, prisma, setupMoney, NOW, type MoneyFixture } from "./money-helpers";

const { GATEWAYS } = await import("@/lib/payments/config");
const { sendBookingRefunds } = await import("@/lib/bookings/money/send");
const { cancelBooking } = await import("@/lib/bookings/cancel");
const { expireHolds } = await import("@/lib/bookings/expiry");
const { paymentState } = await import("@/lib/bookings/obligation");
const { at, book } = await import("./bookings-helpers");

const fixtures: MoneyFixture[] = [];
async function fixture(...args: Parameters<typeof setupMoney>) {
  const created = await setupMoney(...args);
  fixtures.push(created);
  return created;
}

afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  for (const item of fixtures) await item.cleanup();
  await prisma.$disconnect();
});

describe("settling a booking payment", () => {
  it("confirms a held pay-now booking, receipts it and keeps the money caches by trigger", async () => {
    const f = await fixture({ chargeMode: "PAY_NOW" });
    const bookingId = await moneyBooking(f, [26, 28]);
    expect((await moneyOf(bookingId)).booking).toMatchObject({ status: "HELD", awaitingPayment: true, chargeMinor: 100_000 });
    const { paymentId } = await payOnline(f, bookingId, 100_000);
    const { booking, refunds } = await moneyOf(bookingId);
    expect(booking).toMatchObject({ status: "CONFIRMED", awaitingPayment: false, paidMinor: 100_000, refundedMinor: 0 });
    expect(refunds).toHaveLength(0);
    expect(paymentState(booking, NOW)).toBe("PAID");
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { documents: true } });
    expect(payment).toMatchObject({ purpose: "FULL", flaggedAt: null });
    expect(payment.documents.map((document) => document.kind)).toEqual(["TAX_INVOICE"]);
    const kinds = (await prisma.bookingEvent.findMany({ where: { bookingId } })).map((event) => event.kind);
    expect(kinds).toEqual(expect.arrayContaining(["confirmed", "payment"]));
  });

  it("refunds a duplicate capture through the gateway and flags it", async () => {
    const f = await fixture({ chargeMode: "PAY_NOW" });
    const bookingId = await moneyBooking(f, [30, 32]);
    await payOnline(f, bookingId, 100_000);
    const second = await payOnline(f, bookingId, 100_000);
    expect(second.refundIds).toHaveLength(1);
    const refund = vi.spyOn(GATEWAYS.RAZORPAY, "refund").mockResolvedValue({ gatewayRefundId: "rfnd_dup", status: "processed" });
    await sendBookingRefunds(second.refundIds);
    expect(refund).toHaveBeenCalledOnce();
    expect(refund.mock.calls[0][1]).toMatchObject({ amountMinor: 100_000, gatewayPaymentId: second.gatewayPaymentId, refundId: second.refundIds[0] });
    const { booking, refunds } = await moneyOf(bookingId);
    expect(refunds).toMatchObject([{ kind: "DUPLICATE", status: "PROCESSED", amountMinor: 100_000, paymentId: second.paymentId }]);
    expect(booking).toMatchObject({ paidMinor: 200_000, refundedMinor: 100_000, chargeMinor: 100_000 });
    expect(paymentState(booking, NOW)).toBe("PAID");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: second.paymentId } })).flagReason).toMatch(/more than was due/);
    // Sending again is a no-op: the refund is claimed and processed.
    await sendBookingRefunds(second.refundIds);
    expect(refund).toHaveBeenCalledOnce();
  });

  it("confirms an expired hold again when its time is still free (late capture)", async () => {
    const f = await fixture({ chargeMode: "PAY_NOW", holdMinutes: 15 });
    const bookingId = await moneyBooking(f, [40, 42]);
    await expireHolds(at(1));
    expect((await moneyOf(bookingId)).booking.status).toBe("EXPIRED");
    const { paymentId, refundIds } = await payOnline(f, bookingId, 100_000, { now: at(1.5) });
    expect(refundIds).toHaveLength(0);
    const { booking } = await moneyOf(bookingId);
    expect(booking).toMatchObject({ status: "CONFIRMED", paidMinor: 100_000 });
    const rows = await prisma.bookingOccurrence.findMany({ where: { bookingId } });
    expect(rows.every((row) => row.status === "SCHEDULED" && row.blocking)).toBe(true);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).flagReason).toMatch(/confirmed again/);
  });

  it("refunds a late capture in full when the time was taken meanwhile", async () => {
    const f = await fixture({ chargeMode: "PAY_NOW", holdMinutes: 15 });
    const bookingId = await moneyBooking(f, [50, 52]);
    await expireHolds(at(1));
    await book(f, f.space.id, [50, 52], { hold: { now: at(1.2) }, submit: { now: at(1.2) } });
    const { refundIds } = await payOnline(f, bookingId, 100_000, { now: at(1.5) });
    const { booking, refunds } = await moneyOf(bookingId);
    expect(booking.status).toBe("EXPIRED");
    expect(refundIds).toHaveLength(1);
    expect(refunds).toMatchObject([{ kind: "LATE_CAPTURE", status: "PENDING", amountMinor: 100_000 }]);
  });

  it("refunds money that arrives after the booking was cancelled", async () => {
    const f = await fixture({ chargeMode: "PAY_LATER" });
    const bookingId = await moneyBooking(f, [60, 62]);
    await cancelBooking({ makerspaceId: f.makerspaceId, bookingId, actor: f.customer, kind: "CUSTOMER", now: NOW });
    const { booking: cancelled } = await moneyOf(bookingId);
    expect(paymentState(cancelled, NOW)).toBe("VOID");
    await payOnline(f, bookingId, 100_000);
    expect((await moneyOf(bookingId)).refunds).toMatchObject([{ kind: "LATE_CAPTURE", amountMinor: 100_000 }]);
  });
});

describe("money guards", () => {
  it("refuses app writes to the money caches and payments for another makerspace's booking", async () => {
    const f = await fixture({ chargeMode: "PAY_NOW" });
    const other = await fixture({ chargeMode: "PAY_NOW" });
    const bookingId = await moneyBooking(f, [70, 72]);
    await expect(prisma.booking.update({ where: { id: bookingId }, data: { paidMinor: 5 } })).rejects.toThrow();
    await expect(payOnline(other, bookingId, 1000)).rejects.toThrow();
    const { paymentId } = await payOnline(f, bookingId, 100_000);
    await expect(prisma.payment.update({ where: { id: paymentId }, data: { purpose: "DEPOSIT" } })).rejects.toThrow();
    const refund = await prisma.refund.create({ data: { makerspaceId: f.makerspaceId, paymentId, currency: "INR", amountMinor: 10, status: "PROCESSED", processedAt: NOW } });
    await expect(prisma.refund.update({ where: { id: refund.id }, data: { amountMinor: 20 } })).rejects.toThrow();
    await expect(prisma.refund.update({ where: { id: refund.id }, data: { reason: "changed" } })).rejects.toThrow();
    await prisma.refund.update({ where: { id: refund.id }, data: { flaggedAt: NOW, flagReason: "check" } });
    expect((await moneyOf(bookingId)).booking.refundedMinor).toBe(10);
  });

  it("settles and cancels the same booking in parallel without deadlock or lost money", async () => {
    const f = await fixture({ chargeMode: "PAY_NOW" });
    const bookingId = await moneyBooking(f, [80, 82]);
    const results = await Promise.allSettled([
      payOnline(f, bookingId, 100_000),
      cancelBooking({ makerspaceId: f.makerspaceId, bookingId, actor: f.customer, kind: "CUSTOMER", now: NOW }),
    ]);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    const { booking, refunds } = await moneyOf(bookingId);
    expect(booking.status).toBe("CANCELLED");
    expect(booking.paidMinor).toBe(100_000);
    // Whichever ran first, everything paid on a cancelled hold comes back exactly once.
    expect(refunds.reduce((sum, refund) => sum + refund.amountMinor, 0)).toBe(100_000);
  });
});
