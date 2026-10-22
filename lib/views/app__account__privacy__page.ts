import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { PORTAL_ORGANISATION_STATUSES, verifiedEmail } from "@/lib/portal/member";

/** Data protection: consents given to each organisation, erasure requests, and the data export. */
export async function loadAccountPrivacyView() {
  const session = await requireAuth();
  const email = await verifiedEmail(session.user.id);
  if (!email) return { emailVerified: false, organisations: [] };
  const members = await prisma.member.findMany({
    where: { email, anonymisedAt: null, organisation: { status: { in: [...PORTAL_ORGANISATION_STATUSES] }, memberPortal: true } },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: {
      id: true,
      organisation: { select: { slug: true, name: true, logoUrl: true, timezone: true } },
      consents: { orderBy: { grantedAt: "desc" }, take: 20, select: { id: true, purpose: true, noticeVersion: true, grantedAt: true, withdrawnAt: true, byGuardian: true } },
      erasureRequests: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, createdAt: true, decidedAt: true, decisionNote: true } },
    },
  });
  return {
    emailVerified: true,
    organisations: members.map((member) => ({
      memberId: member.id,
      organisation: member.organisation,
      consents: member.consents,
      latestErasure: member.erasureRequests[0] ?? null,
    })),
  };
}
