import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadPublicOrganisation } from "@/lib/publicOrganisation";
import { deriveStatus } from "@/lib/membership/lifecycle";

type Search = { invite?: string };

/**
 * The join form for one plan: the plan, its questions and units, the signed-in person (if any), any
 * standing they already have on it, and whether an invite in the link is usable.
 */
export async function loadJoinView({ params, searchParams }: { params: Promise<{ orgSlug: string; planSlug: string }>; searchParams: Promise<Search> }) {
  const { orgSlug, planSlug } = await params;
  const { invite: inviteToken } = await searchParams;
  const org = await loadPublicOrganisation(orgSlug);
  const plan = await prisma.membershipPlan.findFirst({
    where: { organisationId: org.id, slug: planSlug, archivedAt: null },
    include: { fields: { where: { adminOnly: false }, orderBy: { sortOrder: "asc" } }, units: { select: { unitId: true } } },
  });
  if (!plan) notFound();

  const session = await auth();
  const user = session?.user?.id ? await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, name: true, email: true, emailVerified: true } }) : null;
  const now = new Date();
  const invite = inviteToken ? await prisma.memberInvite.findFirst({ where: { token: inviteToken.slice(0, 128), planId: plan.id }, select: { email: true, uses: true, maxUses: true, revokedAt: true, expiresAt: true, unitId: true } }) : null;
  const inviteState = !inviteToken ? "none" : !invite || invite.revokedAt || invite.uses >= invite.maxUses || (invite.expiresAt && invite.expiresAt <= now) ? "unusable" : invite.email && user?.email && invite.email !== user.email.toLowerCase() ? "other-email" : "ok";

  let standing: string | null = null;
  if (user?.email) {
    const member = await prisma.member.findUnique({ where: { organisationId_email: { organisationId: org.id, email: user.email.toLowerCase() } }, select: { terms: { where: { planId: plan.id } } } });
    if (member?.terms.length) standing = deriveStatus(member.terms, now).status;
  }

  const units = org.unitLevels.length
    ? await prisma.orgUnit.findMany({
        where: { organisationId: org.id, archivedAt: null, ...(plan.allUnits ? {} : { id: { in: plan.units.map((u) => u.unitId) } }) },
        orderBy: { path: "asc" },
        select: { id: true, name: true, level: true },
      })
    : [];

  return {
    org,
    plan,
    units,
    unitLabel: org.unitLevels.at(-1) ?? "Unit",
    user: user ? { name: user.name ?? "", email: user.email ?? "", verified: Boolean(user.emailVerified) } : null,
    standing,
    inviteToken: inviteState === "ok" ? inviteToken! : null,
    inviteState,
    presetUnitId: inviteState === "ok" ? invite?.unitId ?? null : null,
    open: org.status === "ACTIVE" && (plan.joinMode === "OPEN" || plan.joinMode === "APPROVAL" || inviteState === "ok"),
  };
}
