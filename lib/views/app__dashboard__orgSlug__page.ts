import { prisma } from "@/lib/db";
import { can, requireOrgCapability } from "@/lib/permissions";

/** The organisation's home: status, team size and the first steps still to do. */
export async function loadOrgOverviewView({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { organisation, membership } = await requireOrgCapability(orgSlug, "org.view");
  const now = new Date();
  const [details, teamCount, openInvites, gateway] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({
      where: { id: organisation.id },
      select: { name: true, slug: true, status: true, logoUrl: true, kind: true, description: true, contactEmail: true },
    }),
    prisma.teamMember.count({ where: { organisationId: organisation.id } }),
    prisma.teamInvite.count({ where: { organisationId: organisation.id, usedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
    prisma.orgPaymentSettings.findUnique({ where: { organisationId: organisation.id }, select: { provider: true } }),
  ]);
  const manager = can(membership.role, "org.settings");
  const steps = [
    { id: "logo", label: "Add your logo", description: "It appears on your public page and receipts.", done: Boolean(details.logoUrl), href: `/dashboard/${details.slug}/settings`, visible: manager },
    { id: "team", label: "Invite your team", description: "Add the people who run your spaces and bookings.", done: teamCount > 1, href: `/dashboard/${details.slug}/team`, visible: can(membership.role, "team.manage") },
    { id: "payments", label: "Set up payments", description: "Connect Razorpay or Stripe, or take payments offline.", done: Boolean(gateway && gateway.provider !== "NONE"), href: `/dashboard/${details.slug}/settings/payments`, visible: can(membership.role, "payments.settings") },
  ].filter((step) => step.visible);
  return { organisation: details, role: membership.role, teamCount, openInvites, steps };
}
