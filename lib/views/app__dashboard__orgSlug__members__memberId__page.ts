import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { can, requireOrgCapability } from "@/lib/permissions";
import { deriveStatus, statusAt } from "@/lib/membership/lifecycle";
import { memberWhere, teamScope } from "@/lib/membership/scope";
import { loadMemberCardPanel } from "@/lib/cards/panel";

/** One member: profile, roles, every membership with its history, and consent. */
export async function loadMemberView({ params }: { params: Promise<{ orgSlug: string; memberId: string }> }) {
  const { orgSlug, memberId } = await params;
  const { organisation, membership } = await requireOrgCapability(orgSlug, "members.view");
  const scope = await teamScope(organisation.id, membership.unitId);
  const member = await prisma.member.findFirst({
    where: { AND: [memberWhere(scope), { id: memberId }] },
    include: {
      unit: { select: { id: true, name: true } },
      roles: { include: { role: { select: { id: true, name: true, color: true } } }, orderBy: { isPrimary: "desc" } },
      consents: { orderBy: { grantedAt: "desc" }, take: 20 },
      erasureRequests: { orderBy: { createdAt: "desc" }, take: 5, select: { id: true, status: true, reason: true, createdAt: true, decidedAt: true, decisionNote: true } },
      terms: { orderBy: { createdAt: "desc" }, include: { plan: { select: { id: true, name: true, currency: true } }, events: { orderBy: { recordedAt: "desc" }, take: 30 } } },
    },
  });
  if (!member) notFound();

  const now = new Date();
  const [org, plans, roles, units, fields] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: organisation.id }, select: { name: true, slug: true, logoUrl: true, timezone: true, locale: true, unitLevels: true } }),
    prisma.membershipPlan.findMany({ where: { organisationId: organisation.id, archivedAt: null }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    prisma.memberRole.findMany({ where: { organisationId: organisation.id, archivedAt: null }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, color: true } }),
    prisma.orgUnit.findMany({ where: { organisationId: organisation.id, archivedAt: null }, orderBy: { path: "asc" }, select: { id: true, name: true, level: true } }),
    prisma.planField.findMany({ where: { organisationId: organisation.id }, distinct: ["key"], orderBy: { sortOrder: "asc" }, select: { key: true, label: true, type: true, options: true, required: false, helpText: true } }),
  ]);

  const byPlan = new Map<string, typeof member.terms>();
  for (const term of member.terms) byPlan.set(term.planId, [...(byPlan.get(term.planId) ?? []), term]);
  const memberships = [...byPlan.entries()].map(([planId, chain]) => {
    const derived = deriveStatus(chain, now);
    return {
      planId,
      planName: chain[0].plan.name,
      status: derived.status,
      terms: chain.map((term) => ({ ...term, liveStatus: statusAt(term, now, chain.some((other) => other.renewedFromId === term.id && ["UPCOMING", "ACTIVE", "GRACE", "ENDED"].includes(other.status))) })),
      currentId: derived.current?.id ?? null,
    };
  });
  const timeline = member.terms
    .flatMap((term) => term.events.map((event) => ({ ...event, planName: term.plan.name })))
    .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())
    .slice(0, 40);

  const cards = await loadMemberCardPanel(organisation.id, member.id, memberships.map((m) => ({ planId: m.planId, planName: m.planName, started: m.terms.some((term) => term.startsAt !== null) })));

  return {
    org,
    member,
    cards,
    canManageCards: can(membership.role, "cards.manage"),
    memberships,
    timeline,
    plans,
    roles,
    units,
    fields,
    canManage: can(membership.role, "members.manage"),
    showContact: can(membership.role, "members.contact"),
  };
}
