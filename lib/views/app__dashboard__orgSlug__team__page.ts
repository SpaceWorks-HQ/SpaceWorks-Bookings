import { headers } from "next/headers";
import type { TeamRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isOrgAdmin, requireOrgCapability } from "@/lib/permissions";
import { formatRelativeTime } from "@/lib/format/datetime";
import { firstName, type RoleCounts, type TeamMemberRow } from "@/components/team/memberSummary";
type Props = { params: Promise<{ orgSlug: string; }>; searchParams: Promise<{ page?: string; }>; };
const MEMBERS_PAGE_SIZE = 100;
const RECENT_DAYS = 30;
const DISPLAY_TIME_ZONE = "UTC";
const joinedFormatter = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: DISPLAY_TIME_ZONE });

export async function loadOrgMembersView({ params, searchParams }: Props) {
  const { orgSlug } = await params;
  const requestedPage = Math.max(1, Number.parseInt((await searchParams).page ?? "1", 10) || 1);
  const { organisation, membership } = await requireOrgCapability(orgSlug, "org.view");
  const adminView = isOrgAdmin(membership.role);
  const h = await headers();
  const now = new Date();
  const recentSince = new Date(now.getTime() - RECENT_DAYS * 86_400_000);
  const where = { organisationId: organisation.id };
  const [profile, memberCount, roleGroups, recentCount, latestJoiner] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: organisation.id }, select: { logoUrl: true } }),
    prisma.teamMember.count({ where }),
    prisma.teamMember.groupBy({ by: ["role"], where, _count: { _all: true } }),
    prisma.teamMember.count({ where: { ...where, createdAt: { gte: recentSince } } }),
    prisma.teamMember.findFirst({
      where,
      orderBy: { createdAt: "desc" },
      select: { userId: true, createdAt: true, user: { select: { name: true } } },
    }),
  ]);
  const memberPages = Math.max(1, Math.ceil(memberCount / MEMBERS_PAGE_SIZE));
  const memberPage = Math.min(requestedPage, memberPages);
  const members = await prisma.teamMember.findMany({
    where,
    select: { id: true, userId: true, role: true, createdAt: true, user: { select: { name: true, email: adminView } } },
    orderBy: { createdAt: "asc" },
    skip: (memberPage - 1) * MEMBERS_PAGE_SIZE,
    take: MEMBERS_PAGE_SIZE,
  });
  const openInviteWhere = {
    organisationId: organisation.id,
    usedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
  const [invites, openInviteCount] = adminView
    ? await Promise.all([
      prisma.teamInvite.findMany({
        where: openInviteWhere,
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { id: true, token: true, createdAt: true },
      }),
      prisma.teamInvite.count({ where: openInviteWhere }),
    ])
    : [[], 0];
  const baseUrl: string =
    process.env.NEXT_PUBLIC_BASE_URL ??
    (() => {
      const proto = h.get("x-forwarded-proto") ?? "http";
      const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
      return `${proto}://${host}`;
    })();
  const roleCounts: RoleCounts = { OWNER: 0, ADMIN: 0, TREASURER: 0, VIEWER: 0 };
  for (const group of roleGroups) roleCounts[group.role as TeamRole] = group._count._all;
  const latestName =
    latestJoiner == null
      ? null
      : latestJoiner.userId === membership.userId
        ? "you"
        : (firstName(latestJoiner.user.name) ?? "someone new");
  const recentHint = latestJoiner
    ? `Latest: ${latestName}, ${formatRelativeTime(latestJoiner.createdAt, DISPLAY_TIME_ZONE, now).replace(/^(Just now|Yesterday)$/, (word) => word.toLowerCase())}`
    : "No one has joined yet";
  const rows: TeamMemberRow[] = members.map((m) => ({
    id: m.id,
    userId: m.userId,
    name: m.user.name,
    ...(adminView ? { email: m.user.email ?? null } : {}),
    role: m.role,
    joinedLabel: joinedFormatter.format(m.createdAt),
    isYou: m.userId === membership.userId,
  }));
  return { organisation, profile, adminView, memberCount, roleCounts, recentCount, recentHint, openInviteCount, rows, membership, memberPages, memberPage, baseUrl, invites, now };
}
