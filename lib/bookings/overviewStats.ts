import "server-only";

import { prisma } from "@/lib/db";
import { bookingDate, bookingDayWindow } from "@/lib/bookings/publicUi";
import { calendarDays } from "@/lib/bookings/calendarGrid";
import { loadBookingReport } from "@/lib/reports/bookings/load";
import { overallUtilisation, utilisation } from "@/lib/reports/bookings/stats";

/** The overview's figures: today's arrivals, what waits for the team, this week's bookings and use, money this month. */
export async function overviewStats(makerspaceId: string, timezone: string, options: { money: boolean }, now = new Date()) {
  const today = bookingDayWindow(bookingDate(now, timezone), timezone);
  const week = calendarDays(bookingDate(now, timezone), "week");
  const weekWindow = { from: bookingDayWindow(week[0], timezone).start, to: bookingDayWindow(week[6], timezone).end };
  const monthStart = bookingDayWindow(`${bookingDate(now, timezone).slice(0, 8)}01`, timezone).start;
  const [arrivals, requests, overdue, weekBookings, report, received] = await Promise.all([
    prisma.bookingOccurrence.count({ where: { makerspaceId, status: { in: ["SCHEDULED", "CHECKED_IN"] }, startsAt: { gte: today.start, lt: today.end }, booking: { status: "CONFIRMED" } } }),
    prisma.booking.count({ where: { makerspaceId, status: "REQUESTED" } }),
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "Booking" WHERE "makerspaceId" = ${makerspaceId} AND "status" = 'CONFIRMED' AND "writtenOffAt" IS NULL AND "paymentDueAt" < ${now} AND "chargeMinor" > "paidMinor" - "refundedMinor"`,
    prisma.booking.count({ where: { makerspaceId, submittedAt: { not: null }, status: { in: ["CONFIRMED", "REQUESTED"] }, occurrences: { some: { startsAt: { gte: weekWindow.from, lt: weekWindow.to } } } } }),
    loadBookingReport(makerspaceId, weekWindow, { finance: false }),
    options.money ? prisma.payment.groupBy({ by: ["currency"], where: { makerspaceId, status: "PAID", paidAt: { gte: monthStart, lte: now } }, _sum: { amountMinor: true } }) : Promise.resolve([]),
  ]);
  return {
    arrivals, requests, overdue: Number(overdue[0]?.count ?? 0), weekBookings,
    weekUtilisation: overallUtilisation(utilisation(report.spaces, report.occurrences, { start: weekWindow.from.getTime(), end: weekWindow.to.getTime() })),
    received: received.map((row) => ({ currency: row.currency, amountMinor: row._sum.amountMinor ?? 0 })),
  };
}
