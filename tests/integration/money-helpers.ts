import { randomBytes, randomUUID } from "node:crypto";
import type { PaymentProvider, PaymentPurpose } from "@prisma/client";
import type { BookingRules } from "@/lib/bookingRules/schema";

process.env.PAYMENT_SECRETS_KEY ??= randomBytes(32).toString("base64");

const { prisma } = await import("@/lib/db");
const { createPayment, MAKERSPACE_FOR_PAYMENTS } = await import("@/lib/payments/charges");
const { savePaymentKeys } = await import("@/lib/payments/config");
const { settlePayment } = await import("@/lib/payments/settle");
const { addSpace, book, setupMakerspace, NOW } = await import("./bookings-helpers");

/**
 * Booking money fixtures: a makerspace with GST (18%, inclusive, Kerala), optionally a connected gateway, and
 * bookings paid the way a customer would (an attempt, then the provider's capture) or at the desk.
 */

export async function setupMoney(rules: Partial<BookingRules> = {}, options: { provider?: "RAZORPAY" | "STRIPE" | null } = {}) {
  const fixture = await setupMakerspace(rules);
  await prisma.makerspaceTaxSettings.create({ data: { makerspaceId: fixture.makerspaceId, mode: "GST", gstin: "32ABCDE1234F1Z5", legalName: "Tinkerspace Society", address: "Alappuzha", stateCode: "KL", rateBps: 1800, inclusive: true, receiptPrefix: "TINK" } });
  const provider = options.provider === undefined ? "RAZORPAY" : options.provider;
  if (provider) {
    await savePaymentKeys(fixture.makerspaceId, provider === "RAZORPAY"
      ? { provider, keyId: "rzp_test_key", secret: "rzp_secret", webhookSecret: "whsec", testMode: true }
      : { provider, keyId: "pk_test_key", secret: "sk_test_key", webhookSecret: "whsec_test", testMode: true });
  }
  const makerspace = await prisma.makerspace.findUniqueOrThrow({ where: { id: fixture.makerspaceId }, select: MAKERSPACE_FOR_PAYMENTS });
  const space = await addSpace(fixture.makerspaceId);
  return { ...fixture, payments: makerspace, space, provider };
}

export type MoneyFixture = Awaited<ReturnType<typeof setupMoney>>;

/** A booking for `hours` (relative to NOW) on the fixture's space, held or confirmed by its charge mode. */
export async function moneyBooking(fixture: MoneyFixture, hours: [number, number], over: Parameters<typeof book>[3] = {}) {
  const { held } = await book(fixture, fixture.space.id, hours, over);
  return held.bookingId;
}

/** Pay through the gateway: an attempt for the booking, then the provider's capture of `amountMinor`. */
export async function payOnline(fixture: MoneyFixture, bookingId: string, amountMinor: number, options: { purpose?: PaymentPurpose; now?: Date; provider?: PaymentProvider } = {}) {
  const provider = options.provider ?? (fixture.provider ?? "RAZORPAY");
  const payment = await prisma.$transaction((tx) => createPayment(tx, {
    makerspace: fixture.payments, customer: { name: "Asha Menon", email: "asha@example.test", stateCode: "KL" }, currency: "INR",
    items: [{ kind: "BOOKING", description: "Booking", amountMinor }], provider, status: "PENDING", bookingId, purpose: options.purpose ?? "FULL",
  }));
  const gatewayPaymentId = `pay_${randomUUID().slice(0, 12)}`;
  await prisma.payment.update({ where: { id: payment.id }, data: { gatewayOrderId: `order_${payment.id}` } });
  const settled = await prisma.$transaction((tx) => settlePayment(tx, { makerspace: fixture.payments, paymentId: payment.id, capture: { gatewayPaymentId, amountMinor, currency: "INR", method: "upi" }, now: options.now ?? NOW }));
  return { paymentId: payment.id, gatewayPaymentId, refundIds: settled.refundIds };
}

export async function moneyOf(bookingId: string) {
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  const refunds = await prisma.refund.findMany({ where: { payment: { bookingId } }, orderBy: { createdAt: "asc" } });
  return { booking, refunds };
}

export { prisma, NOW };
