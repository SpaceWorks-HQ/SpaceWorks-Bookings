"use server";

import { z } from "zod";
import * as money from "@/lib/bookings/money/staff";
import { sendBookingRefunds } from "@/lib/bookings/money/send";
import { staffAction } from "@/lib/actions/bookingContext";
import { id, makerspaceSlug } from "@/lib/actions/bookingInputs";
import { OFFLINE_METHODS } from "@/lib/payments/offline-methods";

/** The team's money actions on a booking (lib/bookings/money/staff.ts). Refunds they open go to the gateway after commit. */

const booking = z.object({ makerspaceSlug, bookingId: id });
const method = z.enum(OFFLINE_METHODS);
const reason = z.string().trim().min(3, "Give a short reason").max(300);
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable().transform((value) => value || null);

const offlinePaymentSchema = booking.extend({ amountMinor: z.number().int().positive().optional(), method, utr: optionalText(40), reference: optionalText(120), note: z.string().trim().max(300).default("") }).strict();
const refundSchema = booking.extend({ amountMinor: z.number().int().positive(), reason }).strict();
const refundIdSchema = booking.extend({ refundId: id }).strict();
const offlineRefundSchema = refundIdSchema.extend({ method, reference: z.string().trim().min(1, "Enter the reference").max(120) }).strict();
const writeOffSchema = booking.extend({ reason }).strict();
const dueSchema = booking.extend({ dueAt: z.coerce.date() }).strict();

export async function recordBookingPayment(input: unknown) {
  return staffAction(offlinePaymentSchema, input, "payments.record", (data, ctx) => money.recordBookingOfflinePayment({ ...ctx, ...data }));
}

export async function refundBooking(input: unknown) {
  const result = await staffAction(refundSchema, input, "refunds.manage", (data, ctx) => money.refundBooking({ ...ctx, ...data }));
  if (result.ok && result.data) await sendBookingRefunds(result.data.refundIds);
  return result;
}

export async function retryBookingRefund(input: unknown) {
  const result = await staffAction(refundIdSchema, input, "refunds.manage", (data, ctx) => money.retryRefund({ ...ctx, ...data }));
  if (result.ok && result.data) await sendBookingRefunds(result.data.refundIds);
  return result;
}

export async function recordBookingRefundOffline(input: unknown) {
  return staffAction(offlineRefundSchema, input, "refunds.manage", (data, ctx) => money.recordOfflineRefund({ ...ctx, ...data }));
}

export async function writeOffBooking(input: unknown) {
  return staffAction(writeOffSchema, input, "refunds.manage", (data, ctx) => money.writeOffBooking({ ...ctx, ...data }));
}

export async function changePaymentDueDate(input: unknown) {
  return staffAction(dueSchema, input, "bookings.manage", (data, ctx) => money.setPaymentDueAt({ ...ctx, ...data }));
}
