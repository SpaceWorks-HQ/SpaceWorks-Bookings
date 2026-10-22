import { prisma } from "@/lib/db";
import { prepareDataset } from "@/lib/reports/dataset";
import { applicationTimes, approvalStats, joinFunnel } from "@/lib/reports/metrics/approvals";
import { bucketIndex, periodBuckets } from "@/lib/reports/period";
import { openReport, reportShell } from "@/lib/reports/shell";
import { loadReportRows } from "@/lib/reports/source";
import type { ReportSearch } from "@/lib/reports/context";

type Props = { params: Promise<{ orgSlug: string }>; searchParams: Promise<ReportSearch> };

/** B10 approvals queue with time to approve, and the join funnel with drop-off at each step. */
export async function loadOrgReportsApplications({ params, searchParams }: Props) {
  const ctx = await openReport(params, searchParams, "reports.membership");
  const { now, period, scope, org } = ctx;
  const data = prepareDataset(await loadReportRows(scope));
  const stats = approvalStats(data, period, now);
  const funnel = joinFunnel(data, period, now);
  const planName = new Map(ctx.plans.map((plan) => [plan.id, plan.name]));
  const buckets = periodBuckets(period, org.timezone);
  const received = buckets.map(() => 0);
  const approved = buckets.map(() => 0);
  const queue: Array<{ termId: string; memberId: string; appliedAt: Date; plan: string }> = [];
  for (const term of data.terms) {
    const times = applicationTimes(term);
    if (!times.appliedAt) continue;
    const i = bucketIndex(buckets, times.appliedAt);
    if (i >= 0) received[i] += 1;
    if (times.decision === "approved" && times.decidedAt) {
      const j = bucketIndex(buckets, times.decidedAt);
      if (j >= 0) approved[j] += 1;
    }
    if (!times.decision && term.status === "PENDING_APPROVAL") queue.push({ termId: term.id, memberId: term.memberId, appliedAt: times.appliedAt, plan: planName.get(term.planId) ?? "Plan" });
  }
  queue.sort((a, b) => a.appliedAt.getTime() - b.appliedAt.getTime());
  const anonymised = new Set((await prisma.member.findMany({ where: { organisationId: org.id, id: { in: queue.map((row) => row.memberId) }, anonymisedAt: { not: null } }, select: { id: true } })).map((m) => m.id));
  return {
    shell: reportShell(ctx, "applications"),
    stats,
    funnel,
    series: buckets.filter((bucket) => bucket.from <= now).map((bucket, index) => ({ label: bucket.label, received: received[index], approved: approved[index] })),
    queue: queue.filter((row) => !anonymised.has(row.memberId)).slice(0, 100).map((row) => ({
      ...row,
      name: data.memberById.get(row.memberId)?.name ?? "Member",
      memberNumber: data.memberById.get(row.memberId)?.memberNumber ?? 0,
      waitingDays: Math.floor((now.getTime() - row.appliedAt.getTime()) / 86_400_000),
    })),
    canDecide: ctx.can("members.manage"),
  };
}

export type OrgReportsApplications = Awaited<ReturnType<typeof loadOrgReportsApplications>>;
