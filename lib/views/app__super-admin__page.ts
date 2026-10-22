import { requireSuperAdmin } from "@/lib/permissions";
import { MakerspaceStatus, OutboxStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { minutesAgo } from "@/lib/superAdminInsights";

export async function loadSuperAdminOverviewView() {
  await requireSuperAdmin();
  const [byStatus, users, teamMembers, failedEmails, stuckEmails, managersWithoutMfa, unverifiedUsers, staleApplications] = await Promise.all([
    prisma.makerspace.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.user.count(),
    prisma.teamMember.count(),
    prisma.outboxMessage.count({ where: { status: OutboxStatus.FAILED } }),
    prisma.outboxMessage.count({ where: { status: OutboxStatus.PENDING, availableAt: { lt: minutesAgo(15) } } }),
    prisma.user.count({ where: { mfaEnabledAt: null, teamMembers: { some: {} } } }),
    prisma.user.count({ where: { emailVerified: null } }),
    prisma.makerspace.count({ where: { status: MakerspaceStatus.PENDING_REVIEW, updatedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60_000) } } }),
  ]);
  const statusCount = (status: MakerspaceStatus) => byStatus.find((row) => row.status === status)?._count._all ?? 0;
  const makerspaces = byStatus.reduce((sum, row) => sum + row._count._all, 0);

  const activity7d = await prisma.$queryRaw<Array<{ day: string; makerspaces: bigint; users: bigint }>>`
    with days as (
      select generate_series(date_trunc('day', now()) - interval '6 days', date_trunc('day', now()), interval '1 day') as day
    )
    select
      to_char(d.day, 'Mon DD') as day,
      (select count(*) from "Makerspace" o where date_trunc('day', o."createdAt") = d.day) as makerspaces,
      (select count(*) from "User" u where date_trunc('day', u."createdAt") = d.day) as users
    from days d
    order by d.day asc
  `.then((rows) => rows.map((row) => ({ day: row.day, makerspaces: Number(row.makerspaces), users: Number(row.users) })));

  const recentOrgs = await prisma.makerspace.findMany({
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { id: true, name: true, slug: true, status: true, createdAt: true, _count: { select: { teamMembers: true } } },
  });

  const stats = [
    { label: "Active makerspaces", value: statusCount(MakerspaceStatus.ACTIVE) },
    { label: "Waiting for review", value: statusCount(MakerspaceStatus.PENDING_REVIEW) + statusCount(MakerspaceStatus.CHANGES_REQUESTED) },
    { label: "Users", value: users },
    { label: "Team members", value: teamMembers },
  ];
  const attention = [
    { label: "Applications waiting over 7 days", value: staleApplications, href: "/super-admin/makerspaces?status=PENDING_REVIEW" },
    { label: "Suspended makerspaces", value: statusCount(MakerspaceStatus.SUSPENDED), href: "/super-admin/makerspaces?status=SUSPENDED" },
    { label: "Failed emails", value: failedEmails, href: "/super-admin/email" },
    { label: "Emails queued over 15 minutes", value: stuckEmails, href: "/super-admin/email" },
    { label: "Owners and admins without MFA", value: managersWithoutMfa, href: "/super-admin/security" },
    { label: "Users with unverified email", value: unverifiedUsers, href: "/super-admin/users?filter=unverified" },
  ];
  return { stats, attention, activity7d, recentOrgs, makerspaces };
}
