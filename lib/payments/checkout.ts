import "server-only";

import { prisma } from "@/lib/db";
import { getRequestOrigin } from "@/lib/publicUrl";
import { createPayment, MAKERSPACE_FOR_PAYMENTS, PaymentError, type PaymentCustomer } from "./charges";
import type { ChargeItem } from "./tax";
import { gatewayTakes, loadGateway } from "./config";
import { GatewayError, type CheckoutResult } from "./gateway";
import { verifyCheckoutSignature } from "./razorpay";
import { failPayment, settlePayment } from "./settle";

/**
 * Start an online payment: create the Payment (with its tax lines) first, then the gateway order. A gateway
 * refusal closes the attempt as FAILED, so nothing is left dangling. Phase 2 calls this for a booking.
 */
export async function startCheckout(args: { makerspaceId: string; customer: PaymentCustomer; currency: string; items: ChargeItem[]; bookingId?: string | null; description: string; returnPath: string }): Promise<CheckoutResult & { paymentId: string; amountMinor: number; currency: string }> {
  const makerspace = await prisma.makerspace.findUniqueOrThrow({ where: { id: args.makerspaceId }, select: MAKERSPACE_FOR_PAYMENTS });
  if (makerspace.status !== "ACTIVE") throw new PaymentError(`${makerspace.name} isn't taking online payments right now.`);
  const live = await loadGateway(makerspace.id);
  if (!live) throw new PaymentError("Online payment isn't set up here. Use the other ways to pay.");
  if (!gatewayTakes(live.provider, args.currency)) throw new PaymentError(`Online payment doesn't take ${args.currency}. Use the other ways to pay.`);

  const origin = await getRequestOrigin();
  const payment = await prisma.$transaction((tx) => createPayment(tx, { makerspace, customer: args.customer, currency: args.currency, items: args.items, bookingId: args.bookingId, provider: live.provider, status: "PENDING" }));
  try {
    const result = await live.gateway.createCheckout(live.credentials, {
      paymentId: payment.id,
      makerspaceId: makerspace.id,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      description: `${args.description} · ${makerspace.name}`,
      makerspaceName: makerspace.name,
      customer: { name: payment.customerName, email: payment.customerEmail },
      successUrl: `${origin}${args.returnPath}?payment=${payment.id}`,
      cancelUrl: `${origin}${args.returnPath}?cancelled=1`,
    });
    await prisma.payment.update({ where: { id: payment.id }, data: { gatewayOrderId: result.orderId } });
    return { ...result, paymentId: payment.id, amountMinor: payment.amountMinor, currency: payment.currency };
  } catch (error) {
    await prisma.$transaction((tx) => failPayment(tx, { makerspace, paymentId: payment.id, reason: "The payment provider refused the order." }));
    if (error instanceof GatewayError && !error.retryable) throw new PaymentError("The payment provider couldn't start this payment. Try again later or use the other ways to pay.");
    throw new PaymentError("The payment provider couldn't be reached. Try again in a minute.");
  }
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
