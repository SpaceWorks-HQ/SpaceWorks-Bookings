import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatCalendarDate, localDate } from "@/lib/membership/periods";
import { scopedMemberWhere, type ReportScope } from "./source";

/**
 * B11 card issuance, scoped exactly like the membership reports (organisation, the unit subtree through the
 * member, and the plan when set):
 *   issued   – cards with issuedAt in [from, to)
 *   reissued – of those, cards for a (member, plan) that already had an earlier card
 *   revoked  – cards revoked in [from, to) by a manager (not replaced by a reissue)
 *   missing  – members ACTIVE or in GRACE now on a plan with no live card for that (member, plan)
 *   byDay    – issued per local day, for the column chart
 */
export type CardIssuance = { issued: number; reissued: number; revoked: number; missing: number; byDay?: Array<{ label: string; issued: number }> };

export async function loadCardIssuance(scope: ReportScope, window: { from: Date; to: Date }): Promise<CardIssuance | null> {
  const base: Prisma.MemberCardWhereInput = { organisationId: scope.organisationId, member: { is: scopedMemberWhere(scope) }, ...(scope.planId ? { planId: scope.planId } : {}) };
  const [issuedRows, revoked, live, standing, org] = await Promise.all([
    prisma.memberCard.findMany({ where: { ...base, issuedAt: { gte: window.from, lt: window.to } }, select: { memberId: true, planId: true, issuedAt: true } }),
    prisma.memberCard.count({ where: { ...base, revokedAt: { gte: window.from, lt: window.to }, revokedReason: { not: "REISSUED" } } }),
    prisma.memberCard.findMany({ where: { ...base, revokedAt: null }, select: { memberId: true, planId: true } }),
    prisma.membershipTerm.findMany({
      where: { organisationId: scope.organisationId, status: { in: ["ACTIVE", "GRACE"] }, member: { is: scopedMemberWhere(scope) }, ...(scope.planId ? { planId: scope.planId } : {}) },
      distinct: ["memberId", "planId"],
      select: { memberId: true, planId: true },
    }),
    prisma.organisation.findUniqueOrThrow({ where: { id: scope.organisationId }, select: { timezone: true } }),
  ]);
  const totalCards = await prisma.memberCard.count({ where: base });
  if (totalCards === 0 && standing.length === 0) return null;

  const earlier = issuedRows.length
    ? await prisma.memberCard.findMany({
        where: { ...base, issuedAt: { lt: window.to }, OR: issuedRows.map((row) => ({ memberId: row.memberId, planId: row.planId })) },
        select: { memberId: true, planId: true, issuedAt: true },
      })
    : [];
  const reissued = issuedRows.filter((row) => earlier.some((other) => other.memberId === row.memberId && other.planId === row.planId && other.issuedAt < row.issuedAt)).length;
  const liveKeys = new Set(live.map((card) => `${card.memberId}:${card.planId}`));
  const missing = standing.filter((term) => !liveKeys.has(`${term.memberId}:${term.planId}`)).length;

  const days = new Map<string, number>();
  for (const row of [...issuedRows].sort((a, b) => a.issuedAt.getTime() - b.issuedAt.getTime())) {
    const label = formatCalendarDate(localDate(row.issuedAt, org.timezone));
    days.set(label, (days.get(label) ?? 0) + 1);
  }
  return { issued: issuedRows.length, reissued, revoked, missing, byDay: [...days].map(([label, issued]) => ({ label, issued })) };
}
