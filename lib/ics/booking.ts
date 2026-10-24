import type { BookingStatus, OccurrenceStatus } from "@prisma/client";
import { buildIcs, type IcsEvent, type IcsMethod, type IcsStatus } from "./format";

/**
 * Calendar files for bookings. One VEVENT per slot (several units of one time share it), with a stable UID from the
 * slot's first occurrence row and its SEQUENCE, which every reschedule or cancel bumps. Confirmation and reschedule
 * emails attach METHOD:REQUEST; cancellations attach METHOD:CANCEL with the cancelled slots. Pure.
 */

export type IcsOccurrence = { id: string; slotIndex: number; unit: number; startsAt: Date; endsAt: Date; status: OccurrenceStatus; sequence: number; updatedAt: Date };
export type IcsBooking = { reference: string; status: BookingStatus; contactName: string; contactEmail: string };
export type IcsContext = {
  booking: IcsBooking;
  spaceName: string;
  makerspace: { name: string; contactEmail: string | null; address: string | null };
  manageUrl?: string | null;
  now: Date;
};

export function occurrenceUid(occurrenceId: string): string {
  return `${occurrenceId}@bookings.spaceworks`;
}

/** The first row of every slot, in time order. */
export function slotRows<T extends Pick<IcsOccurrence, "slotIndex" | "unit" | "startsAt">>(rows: T[]): T[] {
  const first = new Map<number, T>();
  for (const row of [...rows].sort((a, b) => a.unit - b.unit)) if (!first.has(row.slotIndex)) first.set(row.slotIndex, row);
  return [...first.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export function icsStatus(booking: BookingStatus, occurrence: OccurrenceStatus): IcsStatus {
  if (occurrence === "CANCELLED" || booking === "CANCELLED" || booking === "DECLINED" || booking === "EXPIRED") return "CANCELLED";
  return booking === "CONFIRMED" ? "CONFIRMED" : "TENTATIVE";
}

export function bookingEvent(context: IcsContext, row: IcsOccurrence, attendee = true): IcsEvent {
  const status = icsStatus(context.booking.status, row.status);
  const lines = [`Booking ${context.booking.reference} at ${context.makerspace.name}.`];
  if (context.manageUrl) lines.push(`Manage it: ${context.manageUrl}`);
  return {
    uid: occurrenceUid(row.id),
    sequence: row.sequence,
    dtstamp: context.now,
    lastModified: row.updatedAt,
    start: row.startsAt,
    end: row.endsAt,
    summary: `${context.spaceName} at ${context.makerspace.name}`,
    description: lines.join("\n"),
    location: [context.spaceName, context.makerspace.name, context.makerspace.address].filter(Boolean).join(", "),
    url: context.manageUrl ?? null,
    status,
    organizer: context.makerspace.contactEmail ? { name: context.makerspace.name, email: context.makerspace.contactEmail } : null,
    attendees: attendee ? [{ name: context.booking.contactName, email: context.booking.contactEmail }] : [],
  };
}

/** The invite for an email: REQUEST for live slots, CANCEL for cancelled ones. */
export function bookingInvite(context: IcsContext, rows: IcsOccurrence[], method: Exclude<IcsMethod, "PUBLISH">): string {
  const events = slotRows(rows).map((row) => {
    const event = bookingEvent(context, row);
    return method === "CANCEL" ? { ...event, status: "CANCELLED" as const } : event;
  });
  return buildIcs({ method, events });
}
