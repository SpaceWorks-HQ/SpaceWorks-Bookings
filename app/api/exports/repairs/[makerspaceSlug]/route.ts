import { prisma } from "@/lib/db";
import { auditedTableResponse } from "@/lib/reports/exports/table";
import { exportAccess, majorUnits } from "@/lib/reports/exports/staffAccess";
import { resolvePeriod } from "@/lib/reports/period";
import { payoutState, PAYOUT_LABELS, SEVERITY_LABELS, STATUS_LABELS } from "@/lib/repairs/rules";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Repair spend (`finance.view`): one row per issue reported in the period, with what was asked, approved and paid. */
export async function GET(request: Request, { params }: { params: Promise<{ makerspaceSlug: string }> }) {
  const { makerspaceSlug } = await params;
  const access = await exportAccess(makerspaceSlug, "finance.view");
  if (!access.ok) return new Response(null, { status: access.status, headers: { "Cache-Control": "no-store" } });
  const search = new URL(request.url).searchParams;
  const period = resolvePeriod(Object.fromEntries(search), access.makerspace, new Date());
  const issues = await prisma.spaceIssue.findMany({
    where: { makerspaceId: access.makerspace.id, createdAt: { gte: period.from, lt: period.to } }, orderBy: { createdAt: "asc" }, take: 50_000,
    select: { reference: true, createdAt: true, title: true, severity: true, status: true, currency: true, amountAskedMinor: true, approvedMinor: true, closedAt: true, space: { select: { name: true } }, technician: { select: { name: true, kind: true } }, payouts: { select: { amountMinor: true, paidAt: true } } },
  });
  return auditedTableResponse({
    header: ["Reference", "Reported", "Month", "Space", "Issue", "Severity", "Status", "Technician", "Technician kind", "Currency", "Asked", "Approved", "Paid", "Payment", "Closed"],
    rows: issues.map((row) => {
      const paid = row.payouts.reduce((sum, payout) => sum + payout.amountMinor, 0);
      return [
        row.reference, row.createdAt.toISOString(), row.createdAt.toISOString().slice(0, 7), row.space.name, row.title, SEVERITY_LABELS[row.severity], STATUS_LABELS[row.status],
        row.technician?.name ?? "", row.technician?.kind === "STAFF" ? "Staff" : row.technician ? "External" : "", row.currency,
        row.amountAskedMinor === null ? "" : majorUnits(row.amountAskedMinor, row.currency), row.approvedMinor === null ? "" : majorUnits(row.approvedMinor, row.currency), majorUnits(paid, row.currency),
        PAYOUT_LABELS[payoutState({ amountAskedMinor: row.amountAskedMinor, approvedMinor: row.approvedMinor, paidMinor: paid })], row.closedAt?.toISOString() ?? "",
      ];
    }),
    filename: `repairs-${access.makerspace.slug}-${period.from.toISOString().slice(0, 10)}.csv`,
    audit: { action: "FINANCE_REPORT_EXPORTED", actorUserId: access.userId, makerspaceId: access.makerspace.id, report: "repairs", filters: { period: period.preset, from: period.from.toISOString(), to: period.to.toISOString() } },
  }, search.get("format"));
}
