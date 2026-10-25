import crypto from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/publicUrl", async (importOriginal) => ({ ...(await importOriginal<object>()), getRequestOrigin: async () => "http://127.0.0.1:3011" }));

const { moneyBooking, moneyOf, payOnline, prisma, setupMoney, NOW } = await import("./money-helpers");
type MoneyFixture = Awaited<ReturnType<typeof setupMoney>>;
const { GATEWAYS, ensurePaymentSettings } = await import("@/lib/payments/config");
const { handleWebhook } = await import("@/lib/payments/webhooks");
const { approveBooking } = await import("@/lib/bookings/approval");
const { startBookingPayment } = await import("@/lib/bookings/money/start");
const jobs = await import("@/lib/bookings/money/jobs");
const { recordExternalRefunds } = await import("@/lib/bookings/money/external");
const { sendPendingBookingRefunds } = await import("@/lib/bookings/money/send");
const { cancelBooking } = await import("@/lib/bookings/cancel");
const { paymentState } = await import("@/lib/bookings/obligation");
const { at, noticesOf } = await import("./bookings-helpers");

const fixtures: MoneyFixture[] = [];
async function fixture(...args: Parameters<typeof setupMoney>) {
  const created = await setupMoney(...args);
  fixtures.push(created);
  return created;
}
const razorpay = async (f: MoneyFixture, event: Record<string, unknown>) => {
  const body = JSON.stringify({ created_at: Math.floor(Date.now() / 1000), ...event });
  const code = (await ensurePaymentSettings(f.makerspaceId)).webhookPublicCode;
  return handleWebhook("RAZORPAY", code, body, new Headers({ "x-razorpay-signature": crypto.createHmac("sha256", "whsec").update(body).digest("hex") }));
};

afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  for (const item of fixtures) await item.cleanup();
  await prisma.$disconnect();
});

describe("starting a payment", () => {
  it("takes no money before approval, then one open attempt at a time with the hold stretched for checkout", async () => {
    const f = await fixture({ chargeMode: "PAY_NOW", approvalMode: "APPROVAL" });
    const bookingId = await moneyBooking(f, [30, 32]);
    await expect(startBookingPayment({ makerspaceId: f.makerspaceId, bookingId, actor: f.customer, returnPath: "/x", now: NOW })).rejects.toThrow(/approves/);
    await approveBooking({ makerspaceId: f.makerspaceId, bookingId, actor: f.owner, now: NOW });
    const create = vi.spyOn(GATEWAYS.RAZORPAY, "createCheckout").mockImplementation(async (_credentials, request) => ({ kind: "razorpay", orderId: `order_${request.paymentId}`, keyId: "rzp_test_key" }));
    const first = await startBookingPayment({ makerspaceId: f.makerspaceId, bookingId, actor: f.customer, returnPath: "/x", now: NOW });
    const second = await startBookingPayment({ makerspaceId: f.makerspaceId, bookingId, actor: f.customer, returnPath: "/x", now: NOW });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][1]).toMatchObject({ amountMinor: 100_000 });
    const payments = await prisma.payment.findMany({ where: { bookingId }, orderBy: { createdAt: "asc" } });
    expect(payments.map((payment) => [payment.id, payment.status, payment.purpose])).toEqual([[first.paymentId, "CANCELLED", "FULL"], [second.paymentId, "PENDING", "FULL"]]);
    const lines = await prisma.paymentLine.findMany({ where: { paymentId: second.paymentId } });
    expect(lines[0]).toMatchObject({ amountMinor: 100_000, cgstMinor: 7_627, sgstMinor: 7_627 });
  });
});

describe("due dates", () => {
  it("auto-cancels an approved booking not paid in time and voids it", async () => {
    const f = await fixture({ chargeMode: "PAY_NOW", approvalMode: "APPROVAL", approvalPayWithinHours: 2 });
    const bookingId = await moneyBooking(f, [40, 42]);
    await approveBooking({ makerspaceId: f.makerspaceId, bookingId, actor: f.owner, now: NOW });
    expect((await moneyOf(bookingId)).booking.overdueAction).toBe("AUTO_CANCEL");
    await jobs.handleOverduePayments(at(1));
    expect((await moneyOf(bookingId)).booking.status).toBe("CONFIRMED");
    await jobs.handleOverduePayments(at(3));
    const { booking } = await moneyOf(bookingId);
    expect(booking).toMatchObject({ status: "CANCELLED", cancelKind: "SYSTEM" });
    expect(paymentState(booking, at(3))).toBe("VOID");
  });

  it("reminds before the due date at each offset and tells the team once when it runs late", async () => {
    const f = await fixture({ chargeMode: "PAY_LATER", overdueAction: "NOTIFY_STAFF", paymentReminderHoursBeforeDue: [48, 2], overdueReminderHoursAfterDue: [1] });
    const bookingId = await moneyBooking(f, [96, 98]);
    const due = (await moneyOf(bookingId)).booking.paymentDueAt!;
    const hoursBefore = (hours: number) => new Date(due.getTime() - hours * 3_600_000);
    // The jobs scan every makerspace: count this booking's notices, not the jobs' totals.
    const count = async (kind: string) => (await noticesOf(bookingId)).filter((notice) => notice.endsWith(`:${kind}`)).length;
    await jobs.sendPaymentReminders(hoursBefore(49));
    expect(await count("payment-due")).toBe(0);
    await jobs.sendPaymentReminders(hoursBefore(47));
    await jobs.sendPaymentReminders(hoursBefore(46));
    expect(await count("payment-due")).toBe(1);
    await jobs.sendPaymentReminders(hoursBefore(1));
    expect(await count("payment-due")).toBe(2);
    const after = new Date(due.getTime() + 61 * 60_000);
    await jobs.handleOverduePayments(new Date(due.getTime() + 30 * 60_000));
    expect(await count("payment-overdue")).toBe(0);
    await jobs.handleOverduePayments(after);
    await jobs.handleOverduePayments(after);
    expect(await count("payment-overdue")).toBe(1);
    expect((await moneyOf(bookingId)).booking.status).toBe("CONFIRMED");
  });
});

describe("provider events", () => {
  it("records a refund made in the provider's dashboard as an EXTERNAL refund after the grace period", async () => {
    const f = await fixture({ chargeMode: "PAY_NOW" });
    const bookingId = await moneyBooking(f, [50, 52]);
    const { gatewayPaymentId } = await payOnline(f, bookingId, 100_000);
    const answer = await razorpay(f, { event: "refund.processed", payload: { refund: { entity: { id: "rfnd_dash", payment_id: gatewayPaymentId, amount: 20_000, notes: {} } } } });
    expect(answer.status).toBe(200);
    expect(await recordExternalRefunds(new Date())).toBe(0);
    expect(await recordExternalRefunds(new Date(Date.now() + 31 * 60_000))).toBe(1);
    const { booking, refunds } = await moneyOf(bookingId);
    expect(refunds).toMatchObject([{ kind: "EXTERNAL", status: "PROCESSED", amountMinor: 20_000, gatewayRefundId: "rfnd_dash" }]);
    expect(refunds[0].flaggedAt).not.toBeNull();
    expect(booking).toMatchObject({ refundedMinor: 20_000, concessionMinor: 20_000, chargeMinor: 80_000 });
  });

  it("applies our refund's webhook before the API answer and never lets a later failure undo it", async () => {
    const f = await fixture({ chargeMode: "PAY_NOW" });
    const bookingId = await moneyBooking(f, [54, 56]);
    await payOnline(f, bookingId, 100_000);
    const { refundIds } = await cancelBooking({ makerspaceId: f.makerspaceId, bookingId, actor: f.owner, kind: "VENUE", reason: "Closed", now: NOW });
    const refund = { id: "rfnd_ours", payment_id: "x", amount: 100_000, notes: { refundId: refundIds[0] } };
    expect((await razorpay(f, { event: "refund.processed", payload: { refund: { entity: refund } } })).status).toBe(200);
    expect((await razorpay(f, { event: "refund.failed", created_at: Math.floor(Date.now() / 1000) + 1, payload: { refund: { entity: refund } } })).status).toBe(200);
    const { booking, refunds } = await moneyOf(bookingId);
    expect(refunds).toMatchObject([{ status: "PROCESSED", gatewayRefundId: "rfnd_ours" }]);
    expect(booking.refundedMinor).toBe(100_000);
    // The send job finds nothing left to send.
    const send = vi.spyOn(GATEWAYS.RAZORPAY, "refund");
    await sendPendingBookingRefunds();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("upkeep", () => {
  it("closes checkouts of ended bookings, re-checks stale claims before resending and finds caches consistent", async () => {
    const f = await fixture({ chargeMode: "PAY_NOW" });
    const ended = await moneyBooking(f, [60, 62]);
    const attempt = await prisma.$transaction((tx) => tx.payment.create({ data: { makerspaceId: f.makerspaceId, bookingId: ended, purpose: "FULL", customerName: "A", customerEmail: "a@example.test", provider: "RAZORPAY", currency: "INR", amountMinor: 100_000, gatewayOrderId: `order_${ended}`, taxSnapshot: {} } }));
    await cancelBooking({ makerspaceId: f.makerspaceId, bookingId: ended, actor: f.customer, kind: "CUSTOMER", now: NOW });
    expect(await jobs.closeEndedCheckouts()).toBeGreaterThanOrEqual(1);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: attempt.id } })).status).toBe("CANCELLED");

    const paid = await moneyBooking(f, [64, 66]);
    await payOnline(f, paid, 100_000);
    const { refundIds } = await cancelBooking({ makerspaceId: f.makerspaceId, bookingId: paid, actor: f.owner, kind: "VENUE", reason: "Closed", now: NOW });
    // A sender claimed it and stopped before the provider answered.
    await prisma.refund.update({ where: { id: refundIds[0] }, data: { sentAt: new Date(Date.now() - 60 * 60_000) } });
    const fetch = vi.spyOn(GATEWAYS.RAZORPAY, "fetchRefund").mockResolvedValue({ gatewayRefundId: "rfnd_found", status: "processed" });
    const send = vi.spyOn(GATEWAYS.RAZORPAY, "refund");
    await sendPendingBookingRefunds();
    expect(fetch).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    expect((await moneyOf(paid)).refunds).toMatchObject([{ status: "PROCESSED", gatewayRefundId: "rfnd_found" }]);
    expect(await jobs.checkBookingMoney(f.makerspaceId)).toBe(0);
  });
});
