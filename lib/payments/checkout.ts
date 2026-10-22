import "server-only";

import { prisma } from "@/lib/db";
import { getRequestOrigin } from "@/lib/publicUrl";
import { createPayment, ORG_FOR_PAYMENTS, PaymentError, type PaymentCustomer } from "./charges";
import type { ChargeItem } from "./tax";
import { gatewayTakes, loadGateway } from "./config";
import { GatewayError, type CheckoutResult } from "./gateway";
import { verifyCheckoutSignature } from "./razorpay";
import { failPayment, settlePayment } from "./settle";

/**
 * Start an online payment: create the Payment (with its tax lines) first, then the gateway order. A gateway
 * refusal closes the attempt as FAILED, so nothing is left dangling. Phase 2 calls this for a booking.
 */
export async function startCheckout(args: { organisationId: string; customer: PaymentCustomer; currency: string; items: ChargeItem[]; bookingId?: string | null; description: string; returnPath: string }): Promise<CheckoutResult & { paymentId: string; amountMinor: number; currency: string }> {
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: args.organisationId }, select: ORG_FOR_PAYMENTS });
  if (org.status !== "ACTIVE") throw new PaymentError(`${org.name} isn't taking online payments right now.`);
  const live = await loadGateway(org.id);
  if (!live) throw new PaymentError("Online payment isn't set up here. Use the other ways to pay.");
  if (!gatewayTakes(live.provider, args.currency)) throw new PaymentError(`Online payment doesn't take ${args.currency}. Use the other ways to pay.`);

  const origin = await getRequestOrigin();
  const payment = await prisma.$transaction((tx) => createPayment(tx, { org, customer: args.customer, currency: args.currency, items: args.items, bookingId: args.bookingId, provider: live.provider, status: "PENDING" }));
  try {
    const result = await live.gateway.createCheckout(live.credentials, {
      paymentId: payment.id,
      organisationId: org.id,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      description: `${args.description} · ${org.name}`,
      organisationName: org.name,
      customer: { name: payment.customerName, email: payment.customerEmail },
      successUrl: `${origin}${args.returnPath}?payment=${payment.id}`,
      cancelUrl: `${origin}${args.returnPath}?cancelled=1`,
    });
    await prisma.payment.update({ where: { id: payment.id }, data: { gatewayOrderId: result.orderId } });
    return { ...result, paymentId: payment.id, amountMinor: payment.amountMinor, currency: payment.currency };
  } catch (error) {
    await prisma.$transaction((tx) => failPayment(tx, { org, paymentId: payment.id, reason: "The payment provider refused the order." }));
    if (error instanceof GatewayError && !error.retryable) throw new PaymentError("The payment provider couldn't start this payment. Try again later or use the other ways to pay.");
    throw new PaymentError("The payment provider couldn't be reached. Try again in a minute.");
  }
}

/**
 * Ask the gateway where an open attempt stands and settle or fail it. Used when a customer returns from
 * checkout and by the reconcile job, so a missed webhook never leaves a paid customer waiting.
 */
export async function refreshGatewayPayment(organisationId: string, paymentId: string) {
  const payment = await prisma.payment.findFirst({ where: { id: paymentId, organisationId }, select: { id: true, status: true, provider: true, gatewayOrderId: true } });
  if (!payment || !payment.gatewayOrderId || payment.provider === "OFFLINE") return payment?.status ?? null;
  if (payment.status === "PAID") return "PAID";
  const live = await loadGateway(organisationId);
  if (!live || live.provider !== payment.provider) return payment.status;
  const fetched = await live.gateway.fetchPayment(live.credentials, payment.gatewayOrderId);
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: organisationId }, select: ORG_FOR_PAYMENTS });
  if (fetched.status === "paid") {
    const { payment: settled } = await prisma.$transaction((tx) => settlePayment(tx, { org, paymentId: payment.id, capture: { gatewayPaymentId: fetched.gatewayPaymentId, amountMinor: fetched.amountMinor, currency: fetched.currency, method: fetched.method } }));
    return settled.status;
  }
  if (fetched.status === "failed" && payment.status === "PENDING") {
    await prisma.$transaction((tx) => failPayment(tx, { org, paymentId: payment.id, reason: fetched.reason }));
    return "FAILED";
  }
  return payment.status;
}

/** Razorpay Checkout.js finished in the browser: check its signature, then settle from the provider's record. */
export async function confirmRazorpayCheckout(args: { organisationId: string; paymentId: string; orderId: string; gatewayPaymentId: string; signature: string }) {
  const payment = await prisma.payment.findFirst({ where: { id: args.paymentId, organisationId: args.organisationId, provider: "RAZORPAY" }, select: { gatewayOrderId: true } });
  if (!payment || payment.gatewayOrderId !== args.orderId) throw new PaymentError("Payment not found.");
  const live = await loadGateway(args.organisationId);
  if (!live || live.provider !== "RAZORPAY") throw new PaymentError("Online payment isn't set up for this organisation.");
  if (!verifyCheckoutSignature(live.credentials.secret, args.orderId, args.gatewayPaymentId, args.signature)) throw new PaymentError("The payment couldn't be verified.");
  return refreshGatewayPayment(args.organisationId, args.paymentId);
}
