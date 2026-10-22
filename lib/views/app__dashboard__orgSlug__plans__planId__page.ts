import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { can, requireOrgCapability } from "@/lib/permissions";

async function orgUnits(organisationId: string) {
  return prisma.orgUnit.findMany({ where: { organisationId, archivedAt: null }, orderBy: { path: "asc" }, select: { id: true, name: true, level: true } });
}

/** Everything the new-plan page needs: the default currency and the units a plan can be limited to. */
export async function loadNewPlanView({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { organisation, membership } = await requireOrgCapability(orgSlug, "plans.manage");
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: organisation.id }, select: { name: true, slug: true, logoUrl: true, currency: true } });
  return { org, units: await orgUnits(organisation.id), canManage: !membership.unitId };
}

/** One plan: its settings, its join-form questions and its open invitations. */
export async function loadPlanView({ params }: { params: Promise<{ orgSlug: string; planId: string }> }) {
  const { orgSlug, planId } = await params;
  const { organisation, membership } = await requireOrgCapability(orgSlug, "members.view");
  const plan = await prisma.membershipPlan.findFirst({
    where: { id: planId, organisationId: organisation.id },
    include: { fields: { orderBy: { sortOrder: "asc" } }, units: { select: { unitId: true } }, _count: { select: { terms: true } } },
  });
  if (!plan) notFound();
  const now = new Date();
  const [org, units, invites] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: organisation.id }, select: { name: true, slug: true, logoUrl: true, status: true } }),
    orgUnits(organisation.id),
    prisma.memberInvite.findMany({
      where: { planId: plan.id, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, token: true, email: true, uses: true, maxUses: true, expiresAt: true, createdAt: true, unitId: true },
    }),
  ]);
  return {
    org,
    plan,
    units,
    invites: invites.filter((invite) => invite.uses < invite.maxUses),
    canManagePlan: can(membership.role, "plans.manage") && !membership.unitId,
    canInvite: can(membership.role, "members.manage"),
  };
}
