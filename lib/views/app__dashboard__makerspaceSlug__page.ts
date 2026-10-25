import { prisma } from "@/lib/db";
import { can, requireMakerspaceCapability } from "@/lib/permissions";
import { overviewStats } from "@/lib/bookings/overviewStats";
import { resolvePeriod } from "@/lib/reports/period";
import { financeTotals } from "@/lib/finance/summary";

/** The makerspace's home: status, team size and the first steps still to do. */
export async function loadMakerspaceOverviewView({ params }: { params: Promise<{ makerspaceSlug: string }> }) {
  const { makerspaceSlug } = await params;
  const { makerspace, membership } = await requireMakerspaceCapability(makerspaceSlug, "makerspace.view");
  const now = new Date();
  const [details, teamCount, openInvites, gateway] = await Promise.all([
    prisma.makerspace.findUniqueOrThrow({
      where: { id: makerspace.id },
      select: { name: true, slug: true, status: true, logoUrl: true, kind: true, description: true, contactEmail: true, timezone: true, currency: true, financialYearStartMonth: true },
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
  const stats = await overviewStats(makerspace.id, details.timezone, { money: can(membership.role, "payments.view") }, now);
  const openIssues = can(membership.role, "issues.view") ? await prisma.spaceIssue.count({ where: { makerspaceId: makerspace.id, status: { not: "CLOSED" } } }) : null;
  // Finance figures are the bookings manager's alone (finance.view).
  let finance: { currency: string; income: number; expenses: number; net: number } | null = null;
  if (can(membership.role, "finance.view")) {
    const month = resolvePeriod({ period: "month" }, details, now);
    const rows = await prisma.financeEntry.findMany({ where: { makerspaceId: makerspace.id, occurredAt: { gte: month.from, lt: month.to } }, select: { direction: true, category: true, amountMinor: true, currency: true, method: true, occurredAt: true, spaceId: true } });
    finance = { currency: details.currency, ...financeTotals(rows, details.currency) };
  }
  return { makerspace: details, role: membership.role, teamCount, openInvites, steps, stats, openIssues, finance };
}
