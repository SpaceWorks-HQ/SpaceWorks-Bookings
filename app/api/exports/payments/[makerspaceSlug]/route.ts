import { prisma } from "@/lib/db";
import { auditedCsvResponse } from "@/lib/reports/exports/stream";
import { exportAccess, majorUnits } from "@/lib/reports/exports/staffAccess";
import { resolvePeriod } from "@/lib/reports/period";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Payments and refunds in the period, one row each (`reports.finance`). Amounts in major units of their currency. */
export async function GET(request: Request, { params }: { params: Promise<{ makerspaceSlug: string }> }) {
  const { makerspaceSlug } = await params;
  const access = await exportAccess(makerspaceSlug, "reports.finance");
  if (!access.ok) return new Response(null, { status: access.status, headers: { "Cache-Control": "no-store" } });
  const period = resolvePeriod(Object.fromEntries(new URL(request.url).searchParams), access.makerspace, new Date());
  const [payments, refunds] = await Promise.all([
    prisma.payment.findMany({ where: { makerspaceId: access.makerspace.id, status: "PAID", paidAt: { gte: period.from, lt: period.to } }, orderBy: { paidAt: "asc" }, select: { id: true, paidAt: true, provider: true, method: true, purpose: true, currency: true, amountMinor: true, capturedMinor: true, booking: { select: { reference: true } }, documents: { select: { number: true } } } }),
    prisma.refund.findMany({ where: { makerspaceId: access.makerspace.id, status: "PROCESSED", processedAt: { gte: period.from, lt: period.to } }, orderBy: { processedAt: "asc" }, select: { id: true, processedAt: true, kind: true, method: true, currency: true, amountMinor: true, payment: { select: { provider: true, booking: { select: { reference: true } } } }, document: { select: { number: true } } } }),
  ]);
  const rows = [
    ...payments.map((row) => ["Payment", row.paidAt!.toISOString(), row.booking?.reference ?? "", row.purpose ?? "", row.provider, row.method ?? "", row.currency, majorUnits(row.capturedMinor ?? row.amountMinor, row.currency), row.documents.map((document) => document.number).join(" ")]),
    ...refunds.map((row) => ["Refund", row.processedAt!.toISOString(), row.payment.booking?.reference ?? "", row.kind, row.payment.provider, row.method ?? "", row.currency, -majorUnits(row.amountMinor, row.currency), row.document?.number ?? ""]),
  ].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  return auditedCsvResponse({
    header: ["Type", "When", "Booking", "Purpose or reason", "Provider", "Method", "Currency", "Amount", "Document"],
    rows,
    filename: `payments-${access.makerspace.slug}-${period.from.toISOString().slice(0, 10)}.csv`,
    audit: { action: "FINANCE_REPORT_EXPORTED", actorUserId: access.userId, makerspaceId: access.makerspace.id, report: "payments", filters: { period: period.preset, from: period.from.toISOString(), to: period.to.toISOString() } },
  });
}
