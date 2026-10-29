import "server-only";

import { prisma } from "@/lib/db";
import { getRequestOrigin } from "@/lib/publicUrl";
import { createPayment, lockPayment, lockPaymentBooking, MAKERSPACE_FOR_PAYMENTS, PaymentError, type PaymentCustomer } from "./charges";
import type { ChargeItem, TaxSnapshot } from "./tax";
import type { PaymentPurpose, Prisma } from "@prisma/client";
import { gatewayTakes, loadGateway } from "./config";
import { GatewayError, type CheckoutResult } from "./gateway";
import { verifyCheckoutSignature } from "./razorpay";
import { failPayment, settlePayment } from "./settle";

/**
 * Start an online payment: create the Payment (with its tax lines) first, then the gateway order. A gateway
 * refusal closes the attempt as FAILED, so nothing is left dangling. Phase 2 calls this for a booking.
 */
export type CheckoutInput = { makerspaceId: string; customer: PaymentCustomer; currency: string; items: ChargeItem[]; bookingId?: string | null; purpose?: PaymentPurpose | null; taxSnapshot?: TaxSnapshot; expiresAt?: Date; description: string; returnPath: string };

/** Reserve under the booking lock: closing older attempts and creating this one must commit together. */
export async function reserveCheckout(tx: Prisma.TransactionClient, args: CheckoutInput) {
  const makerspace = await tx.makerspace.findUniqueOrThrow({ where: { id: args.makerspaceId }, select: MAKERSPACE_FOR_PAYMENTS });
  if (makerspace.status !== "ACTIVE") throw new PaymentError(`${makerspace.name} isn't taking online payments right now.`);
  const live = await loadGateway(makerspace.id);
  if (!live) throw new PaymentError("Online payment isn't set up here. Use the other ways to pay.");
  if (!gatewayTakes(live.provider, args.currency)) throw new PaymentError(`Online payment doesn't take ${args.currency}. Use the other ways to pay.`);

  const origin = await getRequestOrigin();
  const payment = await createPayment(tx, { makerspace, customer: args.customer, currency: args.currency, items: args.items, bookingId: args.bookingId, purpose: args.purpose, taxSnapshot: args.taxSnapshot, provider: live.provider, status: "PENDING" });
  return { args, makerspace, live, origin, payment };
}

/** Contact the provider only after reservation commits; SQL locks must never cover a network request. */
export async function openReservedCheckout(prepared: Awaited<ReturnType<typeof reserveCheckout>>): Promise<CheckoutResult & { paymentId: string; amountMinor: number; currency: string }> {
  const { args, makerspace, live, origin, payment } = prepared;
  let result: CheckoutResult;
  try {
    result = await live.gateway.createCheckout(live.credentials, {
      paymentId: payment.id,
      makerspaceId: makerspace.id,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      description: `${args.description} · ${makerspace.name}`,
      makerspaceName: makerspace.name,
      customer: { name: payment.customerName, email: payment.customerEmail },
      successUrl: `${origin}${args.returnPath}${args.returnPath.includes("?") ? "&" : "?"}payment=${payment.id}`,
      cancelUrl: `${origin}${args.returnPath}${args.returnPath.includes("?") ? "&" : "?"}cancelled=1`,
      expiresAt: args.expiresAt,
    });
  } catch (error) {
    await prisma.$transaction((tx) => failPayment(tx, { makerspace, paymentId: payment.id, reason: "The payment provider refused the order." }));
    if (error instanceof GatewayError && !error.retryable) throw new PaymentError("The payment provider couldn't start this payment. Try again later or use the other ways to pay.");
    throw new PaymentError("The payment provider couldn't be reached. Try again in a minute.");
  }
  const status = await prisma.$transaction(async (tx) => {
    const bookingId = await lockPaymentBooking(tx, makerspace.id, payment.id);
    const current = await lockPayment(tx, makerspace.id, payment.id);
    const booking = bookingId ? await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { status: true } }) : null;
    const ended = booking && ["EXPIRED", "CANCELLED", "DECLINED"].includes(booking.status);
    // A webhook can settle before the checkout API returns. Paid rows are immutable.
    if (current.status !== "PAID" && current.status !== "WAIVED") {
      await tx.payment.update({ where: { id: payment.id }, data: { gatewayOrderId: result.orderId, ...(ended && current.status === "PENDING" ? { status: "CANCELLED", note: "Closed: the booking ended." } : {}) } });
    }
    return ended && current.status === "PENDING" ? "CANCELLED" : current.status;
  });
  if (status === "CANCELLED" || status === "FAILED") {
    if (live.gateway.expireCheckout) await live.gateway.expireCheckout(live.credentials, result.orderId).catch(() => console.error("[payments] expiring a superseded checkout failed"));
    throw new PaymentError("This payment attempt was closed. Use the latest checkout or start again.");
  }
  return { ...result, paymentId: payment.id, amountMinor: payment.amountMinor, currency: payment.currency };
}

export async function startCheckout(args: CheckoutInput) {
  return openReservedCheckout(await prisma.$transaction((tx) => reserveCheckout(tx, args)));
}

/**
 * Ask the gateway where an open attempt stands and settle or fail it. Used when a customer returns from
 * checkout and by the reconcile job, so a missed webhook never leaves a paid customer waiting.
 */
export async function refreshGatewayPayment(makerspaceId: string, paymentId: string) {
  const payment = await prisma.payment.findFirst({ where: { id: paymentId, makerspaceId }, select: { id: true, status: true, provider: true, gatewayOrderId: true } });
  if (!payment || !payment.gatewayOrderId || payment.provider === "OFFLINE") return payment?.status ?? null;
  if (payment.status === "PAID") return "PAID";
  const live = await loadGateway(makerspaceId);
  if (!live || live.provider !== payment.provider) return payment.status;
  const fetched = await live.gateway.fetchPayment(live.credentials, payment.gatewayOrderId);
  const makerspace = await prisma.makerspace.findUniqueOrThrow({ where: { id: makerspaceId }, select: MAKERSPACE_FOR_PAYMENTS });
  if (fetched.status === "paid") {
    const { payment: settled } = await prisma.$transaction((tx) => settlePayment(tx, { makerspace, paymentId: payment.id, capture: { gatewayPaymentId: fetched.gatewayPaymentId, amountMinor: fetched.amountMinor, currency: fetched.currency, method: fetched.method } }));
    return settled.status;
  }
  if (fetched.status === "failed" && payment.status === "PENDING") {
    await prisma.$transaction((tx) => failPayment(tx, { makerspace, paymentId: payment.id, reason: fetched.reason }));
    return "FAILED";
  }
  return payment.status;
}

/** Razorpay Checkout.js finished in the browser: check its signature, then settle from the provider's record. */
export async function confirmRazorpayCheckout(args: { makerspaceId: string; paymentId: string; orderId: string; gatewayPaymentId: string; signature: string }) {
  const payment = await prisma.payment.findFirst({ where: { id: args.paymentId, makerspaceId: args.makerspaceId, provider: "RAZORPAY" }, select: { gatewayOrderId: true } });
  if (!payment || payment.gatewayOrderId !== args.orderId) throw new PaymentError("Payment not found.");
  const live = await loadGateway(args.makerspaceId);
  if (!live || live.provider !== "RAZORPAY") throw new PaymentError("Online payment isn't set up for this makerspace.");
  if (!verifyCheckoutSignature(live.credentials.secret, args.orderId, args.gatewayPaymentId, args.signature)) throw new PaymentError("The payment couldn't be verified.");
  return refreshGatewayPayment(args.makerspaceId, args.paymentId);
}
