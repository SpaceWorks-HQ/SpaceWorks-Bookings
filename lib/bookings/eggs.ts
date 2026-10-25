/**
 * Booking easter eggs (pure; docs/DESIGN.md "Easter eggs"). All decorative: they never carry information the
 * page doesn't already say in words.
 */

/** The "Booked" stamp shows on a manage page for a little while after the booking was confirmed. */
export const STAMP_MINUTES = 15;

export function showBookedStamp(booking: { status: string; confirmedAt: Date | string | null }, now: Date): boolean {
  if (booking.status !== "CONFIRMED" || !booking.confirmedAt) return false;
  const age = now.getTime() - new Date(booking.confirmedAt).getTime();
  return age >= 0 && age <= STAMP_MINUTES * 60_000;
}

/** Everyone due today has come in: at least one confirmed arrival, and none still waiting or marked a no-show. */
export function everyoneArrived(rows: Array<{ status: string; noShowAt: Date | string | null; booking: { status: string } }>): boolean {
  const due = rows.filter((row) => row.booking.status === "CONFIRMED" && row.status !== "CANCELLED");
  return due.length > 0 && due.every((row) => !row.noShowAt && (row.status === "CHECKED_IN" || row.status === "COMPLETED"));
}
