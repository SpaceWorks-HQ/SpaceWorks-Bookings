import { notFound } from "next/navigation";
import { requireSuperAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { auditRowSelect } from "@/components/super-admin/AuditTable";
type Props = {
  params: Promise<{ userId: string; }>;
};
export async function loadSuperAdminUserDetailView({ params }: Props) {

  // Layout checks don't re-run on client navigation, so every page checks too.
  const session = await requireSuperAdmin();
  const { userId } = await params;
  const now = new Date();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    // Flags and counts only: no password hash, MFA seed, or recovery codes.
    select: {
      id: true,
      name: true,
      email: true,
      emailVerified: true,
      mfaEnabledAt: true,
      createdAt: true,
      profileImageUrl: true,
      image: true,
      isSuperAdmin: true,
      _count: { select: { teamMembers: true, knownDevices: true } },
    },
  });

  if (!user) notFound();

  const [hasPassword, memberships, auditEvents] = await Promise.all([
    prisma.user.count({ where: { id: user.id, passwordHash: { not: null } } }),
    prisma.teamMember.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, role: true, createdAt: true, makerspace: { select: { id: true, name: true, slug: true } } },
    }),
    prisma.auditEvent.findMany({ where: { actorUserId: user.id }, orderBy: { createdAt: "desc" }, take: 20, select: auditRowSelect }),
  ]);

  const displayName = user.name ?? user.email ?? "Unnamed user";


  return { user, hasPassword, memberships, auditEvents, displayName, now, viewerId: session.user.id };
}
