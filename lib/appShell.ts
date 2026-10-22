import "server-only";

import type { MakerspaceStatus, TeamRole } from "@prisma/client";
import { prisma } from "@/lib/db";

export type ShellMakerspace = {
  slug: string;
  name: string;
  logoUrl: string | null;
  role: TeamRole;
  status: MakerspaceStatus;
};

export type ShellUser = {
  name: string | null;
  email: string | null;
  image: string | null;
};

const MAX_SHELL_MAKERSPACES = 50;

/** Data for the dashboard sidebar: the signed-in person and the makerspaces they are on the team of. */
export async function getAppShellData(userId: string): Promise<{ user: ShellUser; makerspaces: ShellMakerspace[] }> {
  const [user, teams] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, image: true, profileImageUrl: true } }),
    prisma.teamMember.findMany({
      where: { userId },
      select: { role: true, makerspace: { select: { slug: true, name: true, logoUrl: true, status: true } } },
      orderBy: { makerspace: { name: "asc" } },
      take: MAX_SHELL_MAKERSPACES,
    }),
  ]);

  return {
    user: { name: user?.name ?? null, email: user?.email ?? null, image: user?.profileImageUrl ?? user?.image ?? null },
    makerspaces: teams.map(({ role, makerspace }) => ({ ...makerspace, role })),
  };
}
