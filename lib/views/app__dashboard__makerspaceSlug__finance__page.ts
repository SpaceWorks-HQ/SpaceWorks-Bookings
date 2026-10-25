import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { requireMakerspaceTeam } from "@/lib/permissions";
import { can, makerspaceAllows } from "@/lib/permissionRoles";
import { makerspaceSummary, pageNumber } from "@/lib/bookings/staffView";
import { periodBuckets, resolvePeriod, PERIOD_PRESETS } from "@/lib/reports/period";
import { CATEGORY_LABELS, financeTotals, groupBy, METHOD_LABELS, series, signedAmount } from "@/lib/finance/summary";

const PAGE = 50;

/** Where an entry came from, as a dashboard link. */
function sourceHref(slug: string, entry: { sourceType: string; sourceId: string; bookingId: string | null; issueId: string | null; reversesId: string | null }) {
  if (entry.sourceType === "PAYMENT") return `/dashboard/${slug}/payments/${entry.sourceId}`;
  if (entry.sourceType === "REFUND" && entry.bookingId) return `/dashboard/${slug}/bookings/${entry.bookingId}#money`;
  if (entry.sourceType === "REPAIR_PAYOUT" && entry.issueId) return `/dashboard/${slug}/issues/${entry.issueId}`;
  return null;
}

/** The finance page (`finance.view`, bookings managers only): money in and out for a period, by category, way and space. */
export async function loadFinance({ params, searchParams }: { params: Promise<{ makerspaceSlug: string }>; searchParams: Promise<{ period?: string; from?: string; to?: string; page?: string }> }) {
  const { makerspaceSlug } = await params;
  const query = await searchParams;
  const { makerspace, membership } = await requireMakerspaceTeam(makerspaceSlug);
  // Finance is the bookings manager's alone: anyone else gets the same answer as a page that doesn't exist.
  if (!makerspaceAllows(makerspace.status, "finance.view") || !can(membership.role, "finance.view")) notFound();
  const calendar = await prisma.makerspace.findUniqueOrThrow({ where: { id: makerspace.id }, select: { timezone: true, financialYearStartMonth: true, currency: true } });
  const period = resolvePeriod({ period: query.period ?? "fy", from: query.from, to: query.to }, calendar, new Date());
  const where = { makerspaceId: makerspace.id, occurredAt: { gte: period.from, lt: period.to } };
  const page = pageNumber(query.page);
  const buckets = periodBuckets(period, calendar.timezone);
  // Totals are summed in the database (one row per direction, category, way, currency and space), so they hold at any size.
  const sums = (range: { gte: Date; lt: Date }) => prisma.financeEntry.groupBy({ by: ["direction", "category", "method", "currency", "spaceId"], where: { makerspaceId: makerspace.id, occurredAt: range }, _sum: { amountMinor: true } })
    .then((groups) => groups.map((group) => ({ ...group, amountMinor: group._sum.amountMinor ?? 0, occurredAt: range.gte })));
  const [rows, bucketRows, total, entries, spaces] = await Promise.all([
    sums({ gte: period.from, lt: period.to }),
    Promise.all(buckets.map((bucket) => sums({ gte: bucket.from, lt: bucket.to }))),
    prisma.financeEntry.count({ where }),
    prisma.financeEntry.findMany({ where, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], skip: (page - 1) * PAGE, take: PAGE }),
    prisma.space.findMany({ where: { makerspaceId: makerspace.id }, select: { id: true, name: true } }),
  ]);
  const reversed = new Set((await prisma.financeEntry.findMany({ where: { makerspaceId: makerspace.id, reversesId: { in: entries.map((row) => row.id) } }, select: { reversesId: true } })).map((row) => row.reversesId));
  const spaceName = new Map(spaces.map((space) => [space.id, space.name]));
  const currency = calendar.currency;
  return {
    makerspace: await makerspaceSummary(makerspace.id),
    canManage: can(membership.role, "finance.manage"),
    currency,
    otherCurrencies: [...new Set(rows.map((row) => row.currency).filter((value) => value !== currency))],
    period: { preset: period.preset, label: period.label },
    presets: PERIOD_PRESETS.filter((preset) => preset !== "custom"),
    exportQuery: new URLSearchParams(Object.entries({ period: query.period, from: query.from, to: query.to }).filter(([, value]) => typeof value === "string" && value) as Array<[string, string]>).toString(),
    totals: financeTotals(rows, currency),
    buckets: buckets.map((bucket) => bucket.label),
    series: series(bucketRows.flat(), currency, buckets.map((bucket) => ({ from: bucket.from.getTime(), to: bucket.to.getTime() }))),
    byCategory: groupBy(rows, currency, (row) => row.category).map((group) => ({ ...group, label: CATEGORY_LABELS[group.key as keyof typeof CATEGORY_LABELS] })),
    byMethod: groupBy(rows, currency, (row) => row.method).map((group) => ({ ...group, label: METHOD_LABELS[group.key as keyof typeof METHOD_LABELS] })),
    bySpace: groupBy(rows.filter((row) => row.spaceId), currency, (row) => row.spaceId!).map((group) => ({ ...group, label: spaceName.get(group.key) ?? "Space" })),
    page, pages: Math.max(1, Math.ceil(total / PAGE)),
    entries: entries.map((entry) => ({
      id: entry.id, direction: entry.direction, category: CATEGORY_LABELS[entry.category], method: METHOD_LABELS[entry.method], amountMinor: entry.amountMinor,
      signedMinor: signedAmount(entry), currency: entry.currency, occurredAt: entry.occurredAt.toISOString(), reference: entry.reference, note: entry.note,
      space: entry.spaceId ? spaceName.get(entry.spaceId) ?? null : null, sourceType: entry.sourceType, href: sourceHref(makerspace.slug, entry),
      reversible: entry.sourceType === "MANUAL" && !reversed.has(entry.id), reversed: reversed.has(entry.id),
    })),
  };
}
