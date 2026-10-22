import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { can, requireOrgCapability } from "@/lib/permissions";
import { memberWhere, teamScope } from "@/lib/membership/scope";

const DAY_MS = 86_400_000;

/** Member counts for the overview, limited to what this person can see. */
async function memberStats(organisationId: string, unitId: string | null, now: Date) {
  const base: Prisma.MemberWhereInput = { ...memberWhere(await teamScope(organisationId, unitId)), anonymisedAt: null };
  const count = (terms: Prisma.MembershipTermWhereInput) => prisma.member.count({ where: { AND: [base, { terms: { some: terms } }] } });
  const [active, approval, payment, renewals] = await Promise.all([
    count({ status: { in: ["ACTIVE", "GRACE"] } }),
    count({ status: "PENDING_APPROVAL" }),
    count({ status: "PENDING_PAYMENT" }),
    count({ status: "ACTIVE", endsAt: { gte: now, lte: new Date(now.getTime() + 30 * DAY_MS) }, renewals: { none: { status: { notIn: ["CANCELLED", "EXPIRED", "REJECTED"] } } } }),
  ]);
  return { active, approval, payment, renewals };
}

/** The organisation's home: status, team size and the first steps still to do. */
export async function loadOrgOverviewView({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { organisation, membership } = await requireOrgCapability(orgSlug, "org.view");
  const now = new Date();
  const [details, teamCount, openInvites, members, planCount] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({
      where: { id: organisation.id },
      select: { name: true, slug: true, status: true, logoUrl: true, kind: true, description: true, contactEmail: true },
    }),
    prisma.teamMember.count({ where: { organisationId: organisation.id } }),
    prisma.teamInvite.count({ where: { organisationId: organisation.id, usedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
    can(membership.role, "members.view") ? memberStats(organisation.id, membership.unitId, now) : null,
    prisma.membershipPlan.count({ where: { organisationId: organisation.id, archivedAt: null } }),
  ]);
  const manager = can(membership.role, "org.settings");
  const steps = [
    { id: "logo", label: "Add your logo", description: "It appears on your public page, receipts and member cards.", done: Boolean(details.logoUrl), href: `/dashboard/${details.slug}/settings`, visible: manager },
    { id: "team", label: "Invite your team", description: "Add treasurers and admins who help run memberships.", done: teamCount > 1, href: `/dashboard/${details.slug}/team`, visible: can(membership.role, "team.manage") },
    { id: "plan", label: "Create a membership plan", description: "Set the price, duration and how people join.", done: planCount > 0, href: `/dashboard/${details.slug}/plans/new`, visible: manager },
  ].filter((step) => step.visible);
  const digest = ["OWNER", "ADMIN", "TREASURER"].includes(membership.role)
    ? (await prisma.teamMember.findUnique({ where: { id: membership.id }, select: { reportDigest: true } }))?.reportDigest ?? true
    : null;
  return { organisation: details, role: membership.role, teamCount, openInvites, members, steps, digest };
}
