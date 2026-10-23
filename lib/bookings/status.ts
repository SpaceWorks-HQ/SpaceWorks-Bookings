import type { BookingStatus, OccurrenceStatus, Prisma } from "@prisma/client";
import { invalidState } from "./errors";
import type { Tx } from "./db";

/**
 * The only place that changes `Booking.status` and `BookingOccurrence.blocking`.
 *
 * Booking: HELD → REQUESTED | CONFIRMED | EXPIRED | CANCELLED; REQUESTED → CONFIRMED | DECLINED | EXPIRED |
 * CANCELLED; CONFIRMED → CANCELLED. HELD and CONFIRMED block their slots; REQUESTED blocks when the rule
 * `requestsBlockSlot` says so. Occurrence: SCHEDULED → CHECKED_IN | NO_SHOW | CANCELLED | COMPLETED; CHECKED_IN →
 * COMPLETED. Only SCHEDULED and CHECKED_IN rows of a blocking booking block (a database CHECK enforces it); a
 * no-show waiting for the slot to end (`noShowReleasesSlot` off) stays SCHEDULED with `noShowAt` set.
 */

export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  HELD: ["REQUESTED", "CONFIRMED", "EXPIRED", "CANCELLED"],
  REQUESTED: ["CONFIRMED", "DECLINED", "EXPIRED", "CANCELLED"],
  CONFIRMED: ["CANCELLED"],
  DECLINED: [],
  EXPIRED: [],
  CANCELLED: [],
};

export const OCCURRENCE_TRANSITIONS: Record<OccurrenceStatus, readonly OccurrenceStatus[]> = {
  SCHEDULED: ["CHECKED_IN", "NO_SHOW", "CANCELLED", "COMPLETED"],
  CHECKED_IN: ["COMPLETED"],
  NO_SHOW: [],
  CANCELLED: [],
  COMPLETED: [],
};

export const LIVE_BOOKING_STATUSES: readonly BookingStatus[] = ["HELD", "REQUESTED", "CONFIRMED"];
export const ENDED_BOOKING_STATUSES: readonly BookingStatus[] = ["DECLINED", "EXPIRED", "CANCELLED"];
export const BLOCKING_OCCURRENCE_STATUSES: readonly OccurrenceStatus[] = ["SCHEDULED", "CHECKED_IN"];

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
}

export function bookingBlocks(status: BookingStatus, requestsBlockSlot: boolean): boolean {
  return status === "HELD" || status === "CONFIRMED" || (status === "REQUESTED" && requestsBlockSlot);
}

type BookingRef = { id: string; status: BookingStatus };

/**
 * Move a booking to `to`, with any other booking fields in `data`. Ending statuses cancel every scheduled
 * occurrence; otherwise live occurrences block or not as the new status says. Fails if the booking changed
 * underneath (the status in `booking` must still be current).
 */
export async function setBookingStatus(
  tx: Tx,
  booking: BookingRef,
  to: BookingStatus,
  options: { requestsBlockSlot: boolean; now: Date; data?: Prisma.BookingUncheckedUpdateManyInput; cancelKind?: Prisma.BookingOccurrenceUpdateManyMutationInput["cancelKind"] },
): Promise<void> {
  if (booking.status !== to && !canTransition(booking.status, to)) throw invalidState(`A ${booking.status.toLowerCase()} booking can't become ${to.toLowerCase()}.`);
  const updated = await tx.booking.updateMany({ where: { id: booking.id, status: booking.status }, data: { ...options.data, status: to } });
  if (updated.count !== 1) throw invalidState("The booking changed while you were working on it. Try again.");
  if (ENDED_BOOKING_STATUSES.includes(to)) {
    await tx.bookingOccurrence.updateMany({
      where: { bookingId: booking.id, status: "SCHEDULED" },
      data: { status: "CANCELLED", blocking: false, cancelledAt: options.now, cancelKind: options.cancelKind ?? null, sequence: { increment: 1 } },
    });
    return;
  }
  await refreshBlocking(tx, booking.id, bookingBlocks(to, options.requestsBlockSlot));
}

/** Set `blocking` on a booking's live rows (deferred no-shows keep blocking until the slot ends). */
export async function refreshBlocking(tx: Tx, bookingId: string, blocks: boolean): Promise<void> {
  await tx.bookingOccurrence.updateMany({ where: { bookingId, status: { in: [...BLOCKING_OCCURRENCE_STATUSES] }, blocking: !blocks }, data: { blocking: blocks } });
}

/** Release a booking's rows temporarily (before moving units or times); call `refreshBlocking` after. */
export async function releaseRows(tx: Tx, occurrenceIds: string[]): Promise<void> {
  await tx.bookingOccurrence.updateMany({ where: { id: { in: occurrenceIds } }, data: { blocking: false } });
}

/**
 * Move occurrence rows to `to`. Rows not in a state that allows it are refused. Rows leaving SCHEDULED/CHECKED_IN
 * stop blocking.
 */
export async function setOccurrenceStatus(
  tx: Tx,
  rows: Array<{ id: string; status: OccurrenceStatus }>,
  to: OccurrenceStatus,
  data: Prisma.BookingOccurrenceUncheckedUpdateManyInput = {},
): Promise<void> {
  for (const row of rows) {
    if (!OCCURRENCE_TRANSITIONS[row.status].includes(to)) throw invalidState(`A ${row.status.toLowerCase().replace("_", " ")} slot can't become ${to.toLowerCase().replace("_", " ")}.`);
  }
  const blocking = BLOCKING_OCCURRENCE_STATUSES.includes(to) ? undefined : false;
  for (const status of new Set(rows.map((row) => row.status))) {
    const ids = rows.filter((row) => row.status === status).map((row) => row.id);
    const updated = await tx.bookingOccurrence.updateMany({ where: { id: { in: ids }, status }, data: { ...data, status: to, ...(blocking === false ? { blocking: false } : {}) } });
    if (updated.count !== ids.length) throw invalidState("The booking changed while you were working on it. Try again.");
  }
}
