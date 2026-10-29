import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { moneyBooking, moneyOf, payOnline, prisma, setupMoney, NOW, type MoneyFixture } from "./money-helpers";
import { createPayment } from "@/lib/payments/charges";
import { releaseHeldDocument, settlePayment } from "@/lib/payments/settle";
import { expireHolds } from "@/lib/bookings/expiry";
import { at } from "./bookings-helpers";

const fixtures: MoneyFixture[] = [];
async function fixture(mode: "PAY_NOW" | "DEPOSIT" = "PAY_NOW") {
  const f = await setupMoney({ chargeMode: mode, depositPercentBps: 3000 });
  fixtures.push(f);
  return f;
}
async function captureMismatch(f: MoneyFixture, bookingId: string, amountMinor: number, currency = "INR") {
  return prisma.$transaction(async (tx) => {
    const payment = await createPayment(tx, { makerspace: f.payments, customer: { name: "Asha", email: "asha@example.test" }, currency: "INR", provider: "RAZORPAY", status: "PENDING", bookingId, items: [{ kind: "BOOKING", description: "Booking", amountMinor: 100_000 }] });
    return settlePayment(tx, { makerspace: f.payments, paymentId: payment.id, capture: { gatewayPaymentId: `pay_${randomUUID()}`, amountMinor, currency, method: "upi" }, now: NOW });
  });
}
afterAll(async () => {
  for (const f of fixtures) await f.cleanup();
  await prisma.$disconnect();
});

describe("upfront payment requirements", () => {
  it.each(["PAY_NOW", "DEPOSIT"] as const)("keeps %s held until accumulated payments reach its requirement", async (mode) => {
    const f = await fixture(mode);
    const bookingId = await moneyBooking(f, [30, 32]);
    await payOnline(f, bookingId, 10_000);
    expect((await moneyOf(bookingId)).booking).toMatchObject({ status: "HELD", awaitingPayment: true });
    await payOnline(f, bookingId, mode === "DEPOSIT" ? 20_000 : 90_000);
    expect((await moneyOf(bookingId)).booking).toMatchObject({ status: "CONFIRMED", awaitingPayment: false });
  });

  it("requires review of a mismatched capture before it contributes to confirmation", async () => {
    const f = await fixture();
    const bookingId = await moneyBooking(f, [34, 36]);
    const { payment } = await captureMismatch(f, bookingId, 40_000);
    expect(payment).toMatchObject({ status: "PAID", capturedMinor: 40_000, documentHeld: true });
    await payOnline(f, bookingId, 60_000);
    expect((await moneyOf(bookingId)).booking.status).toBe("HELD");
    await prisma.$transaction((tx) => releaseHeldDocument(tx, { makerspace: f.payments, paymentId: payment.id, actorUserId: f.owner.userId, now: NOW }));
    expect((await moneyOf(bookingId)).booking.status).toBe("CONFIRMED");
    expect(await prisma.bookingEvent.count({ where: { bookingId, kind: "payment" } })).toBe(2);
  });

  it("never automatically confirms a capture in another currency", async () => {
    const f = await fixture();
    const bookingId = await moneyBooking(f, [38, 40]);
    const { payment } = await captureMismatch(f, bookingId, 100_000, "USD");
    expect(payment.documentHeld).toBe(true);
    expect((await moneyOf(bookingId)).booking).toMatchObject({ status: "HELD", awaitingPayment: true });
  });

  it("refunds insufficient late money and excludes that refund reservation from a later revival", async () => {
    const f = await fixture();
    const bookingId = await moneyBooking(f, [42, 44]);
    await expireHolds(at(1));
    const first = await payOnline(f, bookingId, 10_000, { now: at(1.1) });
    expect(first.refundIds).toHaveLength(1);
    expect((await moneyOf(bookingId)).booking.status).toBe("EXPIRED");
    const second = await payOnline(f, bookingId, 90_000, { now: at(1.2) });
    expect(second.refundIds).toHaveLength(1);
    expect((await moneyOf(bookingId)).booking.status).toBe("EXPIRED");
    expect((await moneyOf(bookingId)).refunds.reduce((sum, refund) => sum + refund.amountMinor, 0)).toBe(100_000);
  });
});
