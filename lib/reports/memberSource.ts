import "server-only";

import { prisma } from "@/lib/db";
import { loadFinanceRows } from "./finance/source";
import { memberPayments } from "./finance/forecast";
import { memberHistory, memberMembership } from "./member";

/**
 * C1, C2 and C3 for one member of one organisation. The caller must already have proved the viewer may see
 * this member (the portal: `member.userId === session user`; the dashboard: requireOrgCapability plus the
 * unit scope). Returns null for a member outside the organisation, so a guessed id from another tenant is a 404.
 */
export async function loadMemberReport(organisationId: string, memberId: string, now = new Date()) {
  const member = await prisma.member.findFirst({ where: { id: memberId, organisationId }, select: { id: true, organisation: { select: { timezone: true, currency: true } } } });
  if (!member) return null;
  const [terms, events, plans] = await Promise.all([
    prisma.membershipTerm.findMany({
      where: { organisationId, memberId },
      select: { id: true, planId: true, status: true, kind: true, startsAt: true, endsAt: true, graceUntil: true, paymentDueBy: true, renewedFromId: true, createdAt: true },
    }),
    prisma.termStatusEvent.findMany({ where: { organisationId, term: { is: { memberId } } }, select: { termId: true, from: true, to: true, effectiveAt: true, cause: true } }),
    prisma.membershipPlan.findMany({ where: { organisationId, terms: { some: { memberId } } }, select: { id: true, name: true, renewalWindowDays: true } }),
  ]);
  const finance = await loadFinanceRows({ organisationId, unitPath: null, unitId: null, planId: null, scoped: false, memberId });
  return {
    membership: memberMembership(terms, plans, now, member.organisation.timezone),
    history: memberHistory(terms, events, plans),
    payments: memberPayments(finance, memberId, member.organisation.currency),
  };
}

export type MemberReport = NonNullable<Awaited<ReturnType<typeof loadMemberReport>>>;
