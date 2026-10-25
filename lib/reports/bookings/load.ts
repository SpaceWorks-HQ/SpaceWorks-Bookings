import "server-only";

import { prisma } from "@/lib/db";
import { loadSchedule } from "@/lib/availability/context";
import type { ReportBooking, ReportOccurrence, ReportPayment, ReportRefund, ReportSpace } from "./stats";

/** The rows behind the booking reports for one makerspace and window [from, to). Money only with `finance`. */

const CHUNK_MS = 365 * 86_400_000;

async function openRanges(makerspaceId: string, spaceId: string, from: Date, to: Date) {
  const ranges: ReportSpace["open"] = [];
  // Opening hours are expanded at most a year at a time (lib/availability/context.ts refuses longer windows).
  for (let start = from.getTime(); start < to.getTime(); start += CHUNK_MS) {
    const end = Math.min(to.getTime(), start + CHUNK_MS);
    const loaded = await loadSchedule(prisma, { makerspaceId, spaceId, from: new Date(start), to: new Date(end), includeHidden: true });
    ranges.push(...loaded.schedule.open.filter((range) => range.end > start && range.start < end));
  }
  return ranges;
}

export async function loadBookingReport(makerspaceId: string, window: { from: Date; to: Date }, options: { finance: boolean }) {
  const [spaces, occurrences, bookings] = await Promise.all([
    prisma.space.findMany({ where: { makerspaceId, archivedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, units: true } }),
    prisma.bookingOccurrence.findMany({ where: { makerspaceId, startsAt: { lt: window.to }, endsAt: { gt: window.from } }, select: { spaceId: true, bookingId: true, startsAt: true, endsAt: true, status: true, noShowAt: true } }),
    prisma.booking.findMany({ where: { makerspaceId, submittedAt: { not: null }, createdAt: { gte: window.from, lt: window.to } }, select: { id: true, status: true, source: true, cancelKind: true, createdAt: true } }),
  ]);
  const reportSpaces: ReportSpace[] = [];
  for (const space of spaces) reportSpaces.push({ ...space, open: await openRanges(makerspaceId, space.id, window.from, window.to) });
  const rows: ReportOccurrence[] = occurrences.map((row) => ({ spaceId: row.spaceId, bookingId: row.bookingId, startsAt: row.startsAt.getTime(), endsAt: row.endsAt.getTime(), status: row.status === "SCHEDULED" && row.noShowAt ? "NO_SHOW" : row.status }));
  const reportBookings: ReportBooking[] = bookings.map((booking) => ({ ...booking, createdAt: booking.createdAt.getTime() }));
  if (!options.finance) return { spaces: reportSpaces, occurrences: rows, bookings: reportBookings, payments: [] as ReportPayment[], refunds: [] as ReportRefund[], paidAt: [] as number[] };
  const [payments, refunds] = await Promise.all([
    prisma.payment.findMany({ where: { makerspaceId, status: "PAID", paidAt: { gte: window.from, lt: window.to } }, select: { provider: true, method: true, currency: true, amountMinor: true, capturedMinor: true, paidAt: true } }),
    prisma.refund.findMany({ where: { makerspaceId, status: "PROCESSED", processedAt: { gte: window.from, lt: window.to } }, select: { kind: true, currency: true, amountMinor: true, status: true } }),
  ]);
  return {
    spaces: reportSpaces, occurrences: rows, bookings: reportBookings,
    payments: payments.map((payment) => ({ provider: payment.provider, method: payment.method, currency: payment.currency, amountMinor: payment.capturedMinor ?? payment.amountMinor })),
    paidAt: payments.map((payment) => payment.paidAt!.getTime()),
    refunds,
  };
}
