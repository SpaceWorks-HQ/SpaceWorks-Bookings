import { prisma } from "@/lib/db";
import { prepareDataset } from "@/lib/reports/dataset";
import { drillHref } from "@/lib/reports/drillLinks";
import { membershipSummary } from "@/lib/reports/metrics/flows";
import { membershipTrend } from "@/lib/reports/metrics/series";
import { approvalStats } from "@/lib/reports/metrics/approvals";
import { upcomingExpiries } from "@/lib/reports/metrics/breakdowns";
import { countStanding } from "@/lib/reports/metrics/standing";
import { periodBuckets } from "@/lib/reports/period";
import { rollupTrend } from "@/lib/reports/rollupRead";
import { drillFilters, openReport, reportShell } from "@/lib/reports/shell";
import { loadReportRows, scopedTermWhere } from "@/lib/reports/source";
import { loadFinanceRows } from "@/lib/reports/finance/source";
import { revenueSummary } from "@/lib/reports/finance/revenue";
import type { ReportSearch } from "@/lib/reports/context";

/** The directory's own status filter, narrowed to the report's plan and unit subtree. */
function statusHref(slug: string, status: string, filters: { plan?: string; unit?: string }) {
  const query = new URLSearchParams({ status, ...(filters.plan ? { plan: filters.plan } : {}), ...(filters.unit ? { dunit: filters.unit } : {}) });
  return `/dashboard/${slug}/members?${query.toString()}`;
}

type Props = { params: Promise<{ orgSlug: string }>; searchParams: Promise<ReportSearch> };

/**
 * B1 overview: the period's membership change (start, joined, came back, left, end), the trends, the
 * standing mix now, and what needs attention. Every number links to its members.
 */
export async function loadOrgReportsOverview({ params, searchParams }: Props) {
  const ctx = await openReport(params, searchParams, "reports.membership");
  const { now, period, scope } = ctx;
  const data = prepareDataset(await loadReportRows(scope));
  const summary = membershipSummary(data, period, now);
  const previous = membershipSummary(data, period.previous, now);
  const buckets = periodBuckets(period, ctx.org.timezone);
  const live = membershipTrend(data, buckets, now);
  const rolled = await rollupTrend(scope, buckets, ctx.org.timezone, now);
  // Stocks and flows from the daily rollup when it covers the period; renewal rate always from source rows.
  const trend = live.map((point, index) => (rolled?.[index] ? { ...point, active: rolled[index].active, grace: rolled[index].grace, joined: rolled[index].joined, lapsed: rolled[index].lapsed } : point));
  const standing = countStanding(data, now);
  const [pendingApproval, pendingPayment, upcoming] = await Promise.all([
    prisma.membershipTerm.count({ where: { ...scopedTermWhere(scope), status: "PENDING_APPROVAL" } }),
    prisma.membershipTerm.count({ where: { ...scopedTermWhere(scope), status: "PENDING_PAYMENT" } }),
    prisma.membershipTerm.count({ where: { ...scopedTermWhere(scope), status: "UPCOMING" } }),
  ]);
  const approvals = approvalStats(data, period, now);
  const expiring = upcomingExpiries(data, now, 30);
  const filters = drillFilters(ctx);
  const slug = ctx.org.slug;
  const finance = ctx.can("reports.finance") ? revenueSummary(await loadFinanceRows(scope), period, ctx.org.currency) : null;

  return {
    shell: reportShell(ctx, "overview"),
    generatedAt: now,
    timezone: ctx.org.timezone,
    summary,
    previous: { activeEnd: previous.activeEnd, joined: previous.joined, lapsed: previous.lapsed, renewalRate: previous.renewalRate, churnRate: previous.churnRate },
    trend,
    trendSource: rolled ? ("rollup" as const) : ("live" as const),
    bucketUnit: buckets[0]?.key.length === 10 ? ("day" as const) : ("month" as const),
    standing: { ...standing, pendingApproval, pendingPayment, upcoming },
    approvals: { waiting: approvals.waiting, waitingOver7Days: approvals.waitingOver7Days, medianHoursToApprove: approvals.medianHoursToApprove },
    expiringSoon: expiring.length,
    finance: finance ? { net: finance.net, payments: finance.payments } : null,
    currency: ctx.org.currency,
    locale: ctx.org.locale,
    links: {
      active: drillHref(slug, "active", filters),
      grace: drillHref(slug, "grace", filters),
      joined: drillHref(slug, "joined", filters),
      reactivated: drillHref(slug, "reactivated", filters),
      lapsed: drillHref(slug, "lapsed", filters),
      churned: drillHref(slug, "churned", filters),
      revoked: drillHref(slug, "revoked", filters),
      due: drillHref(slug, "due", filters),
      renewed: drillHref(slug, "renewed", filters),
      open: drillHref(slug, "open", filters),
      approval: statusHref(slug, "approval", filters),
      payment: statusHref(slug, "payment", filters),
      expiring: statusHref(slug, "expiring", filters),
      graceNow: statusHref(slug, "grace", filters),
    },
  };
}

export type OrgReportsOverview = Awaited<ReturnType<typeof loadOrgReportsOverview>>;
