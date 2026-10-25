"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { customerBooking, publicAction } from "@/lib/actions/publicBookingContext";
import { id, makerspaceSlug, token } from "@/lib/actions/bookingInputs";
import { invalidInput, notFound } from "@/lib/bookings/errors";
import { startBookingPayment as startPayment } from "@/lib/bookings/money/start";
import { confirmRazorpayCheckout, refreshGatewayPayment } from "@/lib/payments/checkout";
import { PaymentError } from "@/lib/payments/charges";

/** A customer pays for their own booking (manage token or signed-in owner). */

const owned = z.object({ makerspaceSlug, bookingId: id, manageToken: token.optional() });
const startSchema = owned.extend({ full: z.boolean().optional() }).strict();
const razorpaySchema = owned.extend({ paymentId: id, orderId: z.string().trim().min(1).max(64), gatewayPaymentId: z.string().trim().min(1).max(64), signature: z.string().trim().regex(/^[0-9a-f]{64}$/) }).strict();
const refreshSchema = owned.extend({ paymentId: id }).strict();

function paymentErrors<T>(work: () => Promise<T>) {
  return work().catch((error: unknown) => {
    if (error instanceof PaymentError) throw invalidInput(error.message);
    throw error;
  });
}

async function bookingPayment(makerspaceId: string, bookingId: string, paymentId: string) {
  const payment = await prisma.payment.findFirst({ where: { id: paymentId, makerspaceId, bookingId }, select: { id: true } });
  if (!payment) throw notFound("Payment");
  return payment;
}

export async function startBookingPayment(input: unknown) {
  return publicAction(startSchema, input, async (data, ctx) => {
    const { booking, actor } = await customerBooking(ctx.makerspaceId, ctx.actor, data);
    const returnPath = `/m/${data.makerspaceSlug}/bookings/${booking.reference}${data.manageToken ? `?t=${encodeURIComponent(data.manageToken)}` : ""}`;
    const result = await paymentErrors(() => startPayment({ makerspaceId: ctx.makerspaceId, bookingId: booking.id, actor, full: data.full, returnPath }));
    return { ...result, customer: { name: booking.contactName, email: booking.contactEmail }, reference: booking.reference };
  }, { active: true, mutation: true });
}

export async function confirmBookingRazorpay(input: unknown) {
  return publicAction(razorpaySchema, input, async (data, ctx) => {
    const { booking } = await customerBooking(ctx.makerspaceId, ctx.actor, data);
    await bookingPayment(ctx.makerspaceId, booking.id, data.paymentId);
    return { status: await paymentErrors(() => confirmRazorpayCheckout({ makerspaceId: ctx.makerspaceId, paymentId: data.paymentId, orderId: data.orderId, gatewayPaymentId: data.gatewayPaymentId, signature: data.signature })) };
  }, { mutation: true });
}

/** Back from Stripe Checkout (or a slow Razorpay capture): ask the provider where the payment stands. */
export async function refreshBookingPayment(input: unknown) {
  return publicAction(refreshSchema, input, async (data, ctx) => {
    const { booking } = await customerBooking(ctx.makerspaceId, ctx.actor, data);
    await bookingPayment(ctx.makerspaceId, booking.id, data.paymentId);
    return { status: await paymentErrors(() => refreshGatewayPayment(ctx.makerspaceId, data.paymentId)) };
  }, { mutation: true });
}
