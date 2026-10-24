/**
 * Booking report maths (pure, unit-tested). Times are instants (ms); a window is [from, to).
 * - Utilisation of a space = booked unit-minutes / open unit-minutes inside the window. Booked counts live,
 *   checked-in, completed and no-show rows (the time was taken either way); cancelled rows don't count.
 * - Every money total stays per currency.
 */

export type Range = { start: number; end: number };
export type ReportOccurrence = { spaceId: string; bookingId: string; startsAt: number; endsAt: number; status: string };
export type ReportSpace = { id: string; name: string; units: number; open: Range[] };

const TAKEN = new Set(["SCHEDULED", "CHECKED_IN", "COMPLETED", "NO_SHOW"]);

/** Minutes of `range` inside the window. */
export function overlapMinutes(range: Range, window: Range): number {
  return Math.max(0, Math.min(range.end, window.end) - Math.max(range.start, window.start)) / 60_000;
}

export function utilisation(spaces: ReportSpace[], occurrences: ReportOccurrence[], window: Range) {
  return spaces.map((space) => {
    const openMinutes = space.open.reduce((sum, range) => sum + overlapMinutes(range, window), 0) * space.units;
    const bookedMinutes = occurrences
      .filter((row) => row.spaceId === space.id && TAKEN.has(row.status))
      .reduce((sum, row) => sum + overlapMinutes({ start: row.startsAt, end: row.endsAt }, window), 0);
    return { spaceId: space.id, name: space.name, openMinutes, bookedMinutes, ratio: openMinutes > 0 ? Math.min(1, bookedMinutes / openMinutes) : null };
  });
}

/** Booked over open across all spaces, or null when nothing was open. */
export function overallUtilisation(rows: Array<{ openMinutes: number; bookedMinutes: number }>): number | null {
  const open = rows.reduce((sum, row) => sum + row.openMinutes, 0);
  return open > 0 ? Math.min(1, rows.reduce((sum, row) => sum + row.bookedMinutes, 0) / open) : null;
}

export type ReportBooking = { id: string; status: string; source: string; cancelKind: string | null; createdAt: number };

export function statusCounts(bookings: ReportBooking[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const booking of bookings) counts[booking.status] = (counts[booking.status] ?? 0) + 1;
  return counts;
}

/** No-shows among the occurrences whose time came (checked in, completed or no-show). */
export function noShowRate(occurrences: ReportOccurrence[]): { noShows: number; attended: number; rate: number | null } {
  const noShows = occurrences.filter((row) => row.status === "NO_SHOW").length;
  const attended = occurrences.filter((row) => row.status === "CHECKED_IN" || row.status === "COMPLETED").length;
  return { noShows, attended, rate: noShows + attended > 0 ? noShows / (noShows + attended) : null };
}

export type ReportRefund = { kind: string; currency: string; amountMinor: number; status: string };

/** Processed refunds by reason, per currency, largest first. */
export function refundsByKind(refunds: ReportRefund[]) {
  const totals = new Map<string, { kind: string; currency: string; amountMinor: number; count: number }>();
  for (const refund of refunds.filter((row) => row.status === "PROCESSED")) {
    const key = `${refund.kind}|${refund.currency}`;
    const row = totals.get(key) ?? { kind: refund.kind, currency: refund.currency, amountMinor: 0, count: 0 };
    row.amountMinor += refund.amountMinor;
    row.count += 1;
    totals.set(key, row);
  }
  return [...totals.values()].sort((a, b) => b.amountMinor - a.amountMinor);
}

export type ReportPayment = { provider: string; method: string | null; currency: string; amountMinor: number };

/** Money received per way of paying (method, else provider), per currency, largest first. */
export function paymentMethods(payments: ReportPayment[]) {
  const totals = new Map<string, { method: string; currency: string; amountMinor: number; count: number }>();
  for (const payment of payments) {
    const method = payment.method ?? payment.provider.toLowerCase();
    const key = `${method}|${payment.currency}`;
    const row = totals.get(key) ?? { method, currency: payment.currency, amountMinor: 0, count: 0 };
    row.amountMinor += payment.amountMinor;
    row.count += 1;
    totals.set(key, row);
  }
  return [...totals.values()].sort((a, b) => b.amountMinor - a.amountMinor);
}

/** Bookings created per bucket (bucket ranges are [from, to)). */
export function bookingsPerBucket(bookings: ReportBooking[], buckets: Array<{ from: number; to: number }>): number[] {
  return buckets.map((bucket) => bookings.filter((booking) => booking.createdAt >= bucket.from && booking.createdAt < bucket.to).length);
}
