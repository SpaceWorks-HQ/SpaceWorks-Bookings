import { prisma } from "@/lib/db";
import { auditedTableResponse } from "@/lib/reports/exports/table";
import { exportAccess, majorUnits } from "@/lib/reports/exports/staffAccess";
import { resolvePeriod } from "@/lib/reports/period";
import { CATEGORY_LABELS, METHOD_LABELS, signedAmount } from "@/lib/finance/summary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The finance ledger for a period (`finance.view`), CSV or Excel (`?format=xlsx`). Signed amounts in major units. */
export async function GET(request: Request, { params }: { params: Promise<{ makerspaceSlug: string }> }) {
  const { makerspaceSlug } = await params;
  const access = await exportAccess(makerspaceSlug, "finance.view");
  if (!access.ok) return new Response(null, { status: access.status, headers: { "Cache-Control": "no-store" } });
  const search = new URL(request.url).searchParams;
  const period = resolvePeriod(Object.fromEntries(search), access.makerspace, new Date());
  const [entries, spaces] = await Promise.all([
    prisma.financeEntry.findMany({ where: { makerspaceId: access.makerspace.id, occurredAt: { gte: period.from, lt: period.to } }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }], take: 100_000 }),
    prisma.space.findMany({ where: { makerspaceId: access.makerspace.id }, select: { id: true, name: true } }),
  ]);
  const spaceName = new Map(spaces.map((space) => [space.id, space.name]));
  return auditedTableResponse({
    header: ["When", "Direction", "Category", "Method", "Currency", "Amount", "Signed amount", "Reference", "Space", "Source", "Source id", "Reverses", "Note"],
    rows: entries.map((row) => [
      row.occurredAt.toISOString(), row.direction === "IN" ? "In" : "Out", CATEGORY_LABELS[row.category], METHOD_LABELS[row.method], row.currency,
      majorUnits(row.amountMinor, row.currency), majorUnits(signedAmount(row), row.currency), row.reference ?? "", row.spaceId ? spaceName.get(row.spaceId) ?? "" : "",
      row.sourceType, row.sourceId, row.reversesId ?? "", row.note,
    ]),
    filename: `finance-${access.makerspace.slug}-${period.from.toISOString().slice(0, 10)}.csv`,
    audit: { action: "FINANCE_REPORT_EXPORTED", actorUserId: access.userId, makerspaceId: access.makerspace.id, report: "finance", filters: { period: period.preset, from: period.from.toISOString(), to: period.to.toISOString() } },
  }, search.get("format"));
}
