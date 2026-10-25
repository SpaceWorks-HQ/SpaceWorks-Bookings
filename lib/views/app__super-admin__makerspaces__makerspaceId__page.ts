import { notFound } from "next/navigation";
import { requireSuperAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { recordThrottledAuditEvent } from "@/lib/audit";
import { auditRowSelect } from "@/components/super-admin/AuditTable";

type Props = {
  params: Promise<{ makerspaceId: string }>;
};

export async function loadSuperAdminMakerspaceDetailView({ params }: Props) {
  // Layout checks don't re-run on client navigation, so every page checks too.
  const session = await requireSuperAdmin();
  const { makerspaceId } = await params;

  const makerspace = await prisma.makerspace.findUnique({
    where: { id: makerspaceId },
    select: {
      id: true, name: true, slug: true, description: true, logoUrl: true, status: true, source: true, kind: true,
      contactEmail: true, contactPhone: true, addressLine: true, city: true, stateCode: true, postalCode: true, country: true, website: true,
      managerLimit: true, visibility: true, createdAt: true, updatedAt: true,
      _count: { select: { teamMembers: true } },
    },
  });
  if (!makerspace) notFound();
  // A8: a platform admin opening a makerspace's data is audited (once per half hour per makerspace).
  await recordThrottledAuditEvent({ action: "SUPER_ADMIN_ORG_VIEWED", actorUserId: session.user.id, makerspaceId: makerspace.id, targetType: "Makerspace", targetId: makerspace.id, windowMs: 30 * 60_000 }).catch(() => undefined);

  const [reviews, members, invites, assetStats, auditEvents] = await Promise.all([
    prisma.makerspaceReview.findMany({
      where: { makerspaceId: makerspace.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, action: true, reason: true, createdAt: true, actor: { select: { name: true, email: true } } },
    }),
    prisma.teamMember.findMany({
      where: { makerspaceId: makerspace.id },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: { id: true, role: true, createdAt: true, user: { select: { id: true, email: true, name: true } } },
    }),
    prisma.teamInvite.findMany({
      where: { makerspaceId: makerspace.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, role: true, email: true, createdAt: true, expiresAt: true, usedAt: true, usedBy: { select: { email: true } } },
    }),
    prisma.asset.aggregate({ where: { makerspaceId: makerspace.id }, _count: { _all: true }, _sum: { byteSize: true } }),
    prisma.auditEvent.findMany({ where: { makerspaceId: makerspace.id }, orderBy: { createdAt: "desc" }, take: 25, select: auditRowSelect }),
  ]);

  return { makerspace, reviews, members, invites, assetStats, auditEvents, now: new Date() };
}
