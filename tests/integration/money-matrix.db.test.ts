import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { moneyBooking, moneyOf, payOnline, prisma, setupMoney, NOW, type MoneyFixture } from "./money-helpers";

const { GATEWAYS } = await import("@/lib/payments/config");
const { sendBookingRefunds } = await import("@/lib/bookings/money/send");
const { cancelBooking } = await import("@/lib/bookings/cancel");
const { paymentState } = await import("@/lib/bookings/obligation");
const { paymentPlan } = await import("@/lib/bookings/money/start");
const staffMoney = await import("@/lib/bookings/money/staff");

/**
 * The free/paid matrix (build plan, owner requirement 1): every paid charge mode with Razorpay, Stripe and offline
 * only (no gateway: upfront modes degrade to pay later), from booking to payment to a venue cancel and its refunds.
 */

const fixtures: MoneyFixture[] = [];
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  for (const item of fixtures) await item.cleanup();
  await prisma.$disconnect();
});

type Mode = "PAY_NOW" | "DEPOSIT" | "PAY_LATER";
type Provider = "RAZORPAY" | "STRIPE" | null;
const cases: Array<[Mode, Provider]> = (["PAY_NOW", "DEPOSIT", "PAY_LATER"] as Mode[]).flatMap((mode) => (["RAZORPAY", "STRIPE", null] as Provider[]).map((provider) => [mode, provider] as [Mode, Provider]));

async function payWhatIsDue(f: MoneyFixture, bookingId: string) {
  for (let step = 0; step < 3; step += 1) {
    const plan = paymentPlan((await moneyOf(bookingId)).booking);
    if (!plan) return;
    if (f.provider) await payOnline(f, bookingId, plan.amountMinor, { purpose: plan.purpose });
    else await staffMoney.recordBookingOfflinePayment({ makerspaceId: f.makerspaceId, bookingId, actor: f.owner, method: "upi", utr: `UTR${bookingId.slice(-8)}${step}`, now: NOW });
  }
}

describe("the free/paid matrix", () => {
  it.each(cases)("%s with %s: book, pay, venue cancel, refund everything", async (mode, provider) => {
    const f = await setupMoney({ chargeMode: mode, depositPercentBps: 3000 }, { provider });
    fixtures.push(f);
    const bookingId = await moneyBooking(f, [30, 32]);
    const start = (await moneyOf(bookingId)).booking;
    const upfront = mode !== "PAY_LATER" && provider !== null;
    expect(start).toMatchObject({ status: upfront ? "HELD" : "CONFIRMED", awaitingPayment: upfront, payLater: !upfront, chargeMinor: 100_000 });
    if (!upfront) expect(start.paymentDueAt).not.toBeNull();
    if (mode === "DEPOSIT" && upfront) {
      await payOnline(f, bookingId, 30_000, { purpose: "DEPOSIT" });
      const deposited = (await moneyOf(bookingId)).booking;
      expect(deposited.status).toBe("CONFIRMED");
      expect(paymentState(deposited, NOW)).toBe("PARTIALLY_PAID");
    }
    await payWhatIsDue(f, bookingId);
    const paid = (await moneyOf(bookingId)).booking;
    expect(paid).toMatchObject({ status: "CONFIRMED", paidMinor: 100_000 });
    expect(paymentState(paid, NOW)).toBe("PAID");

    const send = vi.spyOn(GATEWAYS[provider ?? "RAZORPAY"], "refund").mockImplementation(async (_credentials, args) => ({ gatewayRefundId: `rfnd_${args.refundId}`, status: "processed" }));
    const cancelled = await cancelBooking({ makerspaceId: f.makerspaceId, bookingId, actor: f.owner, kind: "VENUE", reason: "Closed for repairs", now: NOW });
    await sendBookingRefunds(cancelled.refundIds);
    const { refunds } = await moneyOf(bookingId);
    expect(refunds.reduce((sum, refund) => sum + refund.amountMinor, 0)).toBe(100_000);
    expect(refunds.every((refund) => refund.kind === "VENUE")).toBe(true);
    if (provider) {
      expect(refunds.every((refund) => !refund.offlineRequired && refund.status === "PROCESSED")).toBe(true);
      expect(send).toHaveBeenCalledTimes(refunds.length);
    } else {
      expect(send).not.toHaveBeenCalled();
      for (const refund of refunds.filter((item) => item.offlineRequired)) {
        await staffMoney.recordOfflineRefund({ makerspaceId: f.makerspaceId, bookingId, actor: f.owner, refundId: refund.id, method: "upi", reference: `Back ${refund.id.slice(-6)}` });
      }
    }
    const done = (await moneyOf(bookingId)).booking;
    expect(done).toMatchObject({ status: "CANCELLED", refundedMinor: 100_000, chargeMinor: 0 });
    expect(paymentState(done, NOW)).toBe("REFUNDED");
    const documents = await prisma.taxDocument.findMany({ where: { makerspaceId: f.makerspaceId } });
    expect(documents.filter((document) => document.kind === "CREDIT_NOTE")).toHaveLength(refunds.length);
  });
});
