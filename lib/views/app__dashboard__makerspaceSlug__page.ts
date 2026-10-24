import { prisma } from "@/lib/db";
import { can, requireMakerspaceCapability } from "@/lib/permissions";

/** The makerspace's home: status, team size and the first steps still to do. */
export async function loadMakerspaceOverviewView({ params }: { params: Promise<{ makerspaceSlug: string }> }) {
  const { makerspaceSlug } = await params;
  const { makerspace, membership } = await requireMakerspaceCapability(makerspaceSlug, "makerspace.view");
  const now = new Date();
  const [details, teamCount, openInvites, gateway] = await Promise.all([
    prisma.makerspace.findUniqueOrThrow({
      where: { id: makerspace.id },
      select: { name: true, slug: true, status: true, logoUrl: true, kind: true, description: true, contactEmail: true },
    }),
    prisma.teamMember.count({ where: { makerspaceId: makerspace.id } }),
    prisma.teamInvite.count({ where: { makerspaceId: makerspace.id, usedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
    prisma.makerspacePaymentSettings.findUnique({ where: { makerspaceId: makerspace.id }, select: { provider: true } }),
  ]);
  const manager = can(membership.role, "makerspace.settings");
  const steps = [
    { id: "logo", label: "Add your logo", description: "It appears on your public page and receipts.", done: Boolean(details.logoUrl), href: `/dashboard/${details.slug}/settings`, visible: manager },
    { id: "team", label: "Invite your team", description: "Add the people who run your spaces and bookings.", done: teamCount > 1, href: `/dashboard/${details.slug}/team`, visible: can(membership.role, "team.manage") },
    { id: "payments", label: "Set up payments", description: "Connect Razorpay or Stripe, or take payments offline.", done: Boolean(gateway && gateway.provider !== "NONE"), href: `/dashboard/${details.slug}/settings/payments`, visible: can(membership.role, "payments.settings") },
  ].filter((step) => step.visible);
  return { makerspace: details, role: membership.role, teamCount, openInvites, steps };
}
