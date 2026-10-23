import { prisma } from "@/lib/db";
import { requireMakerspaceCapability } from "@/lib/permissions";
import { makerspaceSummary } from "@/lib/bookings/staffView";

/**
 * Reconciliation: what needs a person's attention (open checkouts, flagged payments, refunds waiting to be handed
 * back, sent, or retried) and the last 14 days of money in and out per provider, in the makerspace's time zone.
 */
export async function loadReconciliation({ params }: { params: Promise<{ makerspaceSlug: string }> }) {
  const { makerspaceSlug } = await params;
  const { makerspace } = await requireMakerspaceCapability(makerspaceSlug, "payments.view");
  const summary = await makerspaceSummary(makerspace.id);
  const now = new Date();
  const since = new Date(now.getTime() - 14 * 86_400_000);
  const booking = { select: { id: true, reference: true } } as const;
  const [open, flagged, refunds, paidDays, refundDays] = await Promise.all([
    prisma.payment.findMany({ where: { makerspaceId: makerspace.id, status: "PENDING", createdAt: { lt: new Date(now.getTime() - 10 * 60_000) } }, orderBy: { createdAt: "asc" }, take: 50,
      select: { id: true, provider: true, amountMinor: true, currency: true, createdAt: true, customerName: true, booking } }),
    prisma.payment.findMany({ where: { makerspaceId: makerspace.id, flaggedAt: { not: null } }, orderBy: { flaggedAt: "desc" }, take: 50,
      select: { id: true, provider: true, amountMinor: true, capturedMinor: true, currency: true, flaggedAt: true, flagReason: true, customerName: true, booking } }),
    prisma.refund.findMany({ where: { makerspaceId: makerspace.id, OR: [{ status: "PENDING" }, { status: "FAILED", retry: null }] }, orderBy: { createdAt: "asc" }, take: 100,
      select: { id: true, status: true, kind: true, amountMinor: true, currency: true, createdAt: true, offlineRequired: true, sentAt: true, failureReason: true, payment: { select: { provider: true, customerName: true, booking } } } }),
    prisma.$queryRaw<Array<{ day: string; provider: string; currency: string; total: bigint; count: bigint }>>`
      SELECT to_char(("paidAt" AT TIME ZONE 'UTC') AT TIME ZONE ${summary.timezone}, 'YYYY-MM-DD') AS day, "provider"::text AS provider, "currency",
             SUM(COALESCE("capturedMinor", "amountMinor"))::bigint AS total, COUNT(*)::bigint AS count
      FROM "Payment" WHERE "makerspaceId" = ${makerspace.id} AND "status" = 'PAID' AND "paidAt" >= ${since}
      GROUP BY 1, 2, 3 ORDER BY 1 DESC, 2`,
    prisma.$queryRaw<Array<{ day: string; provider: string; currency: string; total: bigint; count: bigint }>>`
      SELECT to_char((r."processedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${summary.timezone}, 'YYYY-MM-DD') AS day, p."provider"::text AS provider, r."currency",
             SUM(r."amountMinor")::bigint AS total, COUNT(*)::bigint AS count
      FROM "Refund" r JOIN "Payment" p ON p."id" = r."paymentId"
      WHERE r."makerspaceId" = ${makerspace.id} AND r."status" = 'PROCESSED' AND r."processedAt" >= ${since}
      GROUP BY 1, 2, 3 ORDER BY 1 DESC, 2`,
  ]);
  const iso = (value: Date | null) => value?.toISOString() ?? null;
  const days = new Map<string, { day: string; provider: string; currency: string; inMinor: number; outMinor: number; payments: number; refunds: number }>();
  const slot = (row: { day: string; provider: string; currency: string }) => {
    const key = `${row.day}|${row.provider}|${row.currency}`;
    if (!days.has(key)) days.set(key, { day: row.day, provider: row.provider, currency: row.currency, inMinor: 0, outMinor: 0, payments: 0, refunds: 0 });
    return days.get(key)!;
  };
  for (const row of paidDays) Object.assign(slot(row), { inMinor: Number(row.total), payments: Number(row.count) });
  for (const row of refundDays) Object.assign(slot(row), { outMinor: Number(row.total), refunds: Number(row.count) });
  return {
    makerspace: summary,
    open: open.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    flagged: flagged.map((row) => ({ ...row, flaggedAt: iso(row.flaggedAt) })),
    refunds: refunds.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), sentAt: iso(row.sentAt), stuck: row.status === "PENDING" && now.getTime() - row.createdAt.getTime() > 86_400_000 })),
    days: [...days.values()].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.provider.localeCompare(b.provider))),
  };
}
