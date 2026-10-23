import type { Booking } from "@prisma/client";
import type { Tx } from "./db";

/**
 * Hook points for later phases. `onBookingConfirmed` runs inside the transaction that confirmed the booking
 * (submit, approval or `confirmPaidBooking`); Phase 2 and Phase 3 (webhooks) register handlers at start-up.
 * A handler that throws rolls the confirmation back.
 */

export type BookingConfirmedHandler = (tx: Tx, booking: Booking) => Promise<void>;
const confirmedHandlers = new Set<BookingConfirmedHandler>();

export function onBookingConfirmed(handler: BookingConfirmedHandler): () => void {
  confirmedHandlers.add(handler);
  return () => confirmedHandlers.delete(handler);
}

export async function runBookingConfirmed(tx: Tx, bookingId: string): Promise<void> {
  if (confirmedHandlers.size === 0) return;
  const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
  for (const handler of confirmedHandlers) await handler(tx, booking);
}
