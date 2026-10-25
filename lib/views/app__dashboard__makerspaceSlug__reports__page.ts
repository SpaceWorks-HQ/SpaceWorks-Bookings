import { prisma } from "@/lib/db";
import { requireMakerspaceCapability } from "@/lib/permissions";
import { can, makerspaceAllows } from "@/lib/permissionRoles";
import { makerspaceSummary } from "@/lib/bookings/staffView";
import { periodBuckets, resolvePeriod, PERIOD_PRESETS } from "@/lib/reports/period";
import { loadBookingReport } from "@/lib/reports/bookings/load";
import { spaceRepairCosts } from "@/lib/finance/summary";
import { bookingsPerBucket, noShowRate, overallUtilisation, paymentMethods, refundsByKind, statusCounts, utilisation } from "@/lib/reports/bookings/stats";

/** Reports: utilisation, bookings, no-shows; money (revenue, refunds, methods) only with `reports.finance`. */
export async function loadReports({ params, searchParams }: { params: Promise<{ makerspaceSlug: string }>; searchParams: Promise<{ period?: string; from?: string; to?: string }> }) {
  const { makerspaceSlug } = await params;
  const query = await searchParams;
  const access = await requireMakerspaceCapability(makerspaceSlug, "reports.view");
  const makerspaceId = access.makerspace.id;
  const finance = makerspaceAllows(access.makerspace.status, "reports.finance") && can(access.membership.role, "reports.finance");
  const calendar = await prisma.makerspace.findUniqueOrThrow({ where: { id: makerspaceId }, select: { timezone: true, financialYearStartMonth: true, currency: true } });
  const now = new Date();
  const period = resolvePeriod(query, calendar, now);
  const buckets = periodBuckets(period, calendar.timezone);
  const rows = await loadBookingReport(makerspaceId, period, { finance });
  const window = { start: period.from.getTime(), end: period.to.getTime() };
  const perSpace = utilisation(rows.spaces, rows.occurrences, window);
  const bucketRanges = buckets.map((bucket) => ({ from: bucket.from.getTime(), to: bucket.to.getTime() }));
  const revenue = finance ? bucketRanges.map((bucket) => rows.payments.reduce((sum, payment, index) => sum + (payment.currency === calendar.currency && rows.paidAt[index] >= bucket.from && rows.paidAt[index] < bucket.to ? payment.amountMinor : 0), 0)) : [];
  // Per space: booking income (less refunds) against repair payouts, from the ledger (finance only).
  const ledger = finance ? await prisma.financeEntry.findMany({ where: { makerspaceId, occurredAt: { gte: period.from, lt: period.to }, spaceId: { not: null } }, select: { direction: true, category: true, amountMinor: true, currency: true, method: true, occurredAt: true, spaceId: true } }) : [];
  const costs = spaceRepairCosts(ledger, calendar.currency);
  const spaceRepairs = finance ? perSpace.map((row) => ({ spaceId: row.spaceId, name: row.name, ...(costs.get(row.spaceId) ?? { revenue: 0, repairs: 0 }) })) : [];
  return {
    makerspace: await makerspaceSummary(makerspaceId),
    spaceRepairs,
    currency: calendar.currency,
    finance,
    period: { preset: period.preset, label: period.label, from: period.from.toISOString(), to: period.to.toISOString(), firstDay: query.from ?? null, lastDay: query.to ?? null },
    presets: PERIOD_PRESETS.filter((preset) => preset !== "custom"),
    buckets: buckets.map((bucket) => bucket.label),
    perSpace,
    overall: overallUtilisation(perSpace),
    statuses: statusCounts(rows.bookings),
    bookingsSeries: bookingsPerBucket(rows.bookings, bucketRanges),
    noShows: noShowRate(rows.occurrences),
    revenueSeries: revenue,
    received: finance ? paymentMethods(rows.payments) : [],
    refunds: finance ? refundsByKind(rows.refunds) : [],
    exportQuery: new URLSearchParams(Object.entries(query).filter(([, value]) => typeof value === "string" && value) as Array<[string, string]>).toString(),
  };
}
