import type { Prisma } from "@prisma/client";
import { actorUserId, type Actor } from "./actor";
import type { Tx } from "./db";

/**
 * The booking timeline (append-only `BookingEvent`) plus an `AuditEvent` whenever staff act. Event data never
 * carries contact details or tokens.
 */

export type BookingEventKind =
  | "held"
  | "submitted"
  | "requested"
  | "confirmed"
  | "approved"
  | "declined"
  | "expired"
  | "cancelled"
  | "rescheduled"
  | "moved"
  | "checked-in"
  | "no-show"
  | "completed"
  | "payment-due-changed"
  | "manage-link-sent"
  | "payment"
  | "refund"
  | "refund-failed"
  | "written-off"
  | "revived";

export async function recordBookingEvent(
  tx: Tx,
  event: { makerspaceId: string; bookingId: string; kind: BookingEventKind; actor: Actor; occurrenceId?: string | null; data?: Record<string, unknown> },
): Promise<void> {
  const data = JSON.parse(JSON.stringify(event.data ?? {})) as Prisma.InputJsonValue;
  await tx.bookingEvent.create({
    data: {
      makerspaceId: event.makerspaceId,
      bookingId: event.bookingId,
      occurrenceId: event.occurrenceId ?? null,
      kind: event.kind,
      actorKind: event.actor.kind,
      actorUserId: actorUserId(event.actor),
      data,
    },
  });
  if (event.actor.kind === "STAFF") {
    await tx.auditEvent.create({
      data: {
        action: `BOOKING_${event.kind.toUpperCase().replace(/-/g, "_")}`,
        actorUserId: event.actor.userId,
        makerspaceId: event.makerspaceId,
        targetType: "Booking",
        targetId: event.bookingId,
        metadata: data,
      },
    });
  }
}
