import type { Prisma } from "@prisma/client";
import type { Tx } from "./db";

/**
 * Queue a customer email about a booking in the caller's transaction (lib/email/bookings.ts renders it). A notice
 * that carries the manage token uses the capability kind `booking-link`, whose outbox row is deleted once sent.
 */

export const BOOKING_NOTICES = [
  "received",
  "requested",
  "confirmed",
  "approved",
  "declined",
  "request-expired",
  "reminder",
  "cancelled",
  "rescheduled",
  "checked-in",
  "payment-due",
  "payment-overdue",
  "manage-link",
] as const;
export type BookingNotice = (typeof BOOKING_NOTICES)[number];

export type BookingNoticePayload = {
  makerspaceId: string;
  bookingId: string;
  notice: BookingNotice;
  /** The occurrences the notice is about (cancelled, rescheduled, reminded); all live ones when absent. */
  occurrenceIds?: string[];
  manageToken?: string;
  keptFeeMinor?: number;
  refundDueMinor?: number;
  balanceDueMinor?: number;
  reason?: string;
};

export async function enqueueBookingNotice(tx: Tx, payload: BookingNoticePayload): Promise<void> {
  await tx.outboxMessage.create({
    data: { kind: payload.manageToken ? "booking-link" : "booking-notice", payload: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue },
  });
}
