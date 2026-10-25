import "server-only";

import type { MakerspaceStatus, TeamRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format/datetime";
import { MANAGER_ROLE } from "@/lib/permissionRoles";

export type AccountMembershipRow = {
  id: string;
  makerspace: { slug: string; name: string; logoUrl: string | null; status: MakerspaceStatus };
  role: TeamRole;
  joinedLabel: string;
  /** The only OWNER left; leaving would orphan the makerspace. */
  lastManager: boolean;
};

export type AccountMakerspacesData = {
  teamMembers: AccountMembershipRow[];
};

/** The makerspace teams one user is on. Selects are explicit: other people are never read. */
export async function loadAccountMakerspaces(userId: string): Promise<AccountMakerspacesData> {
  const teams = await prisma.teamMember.findMany({
    where: { userId },
    orderBy: { makerspace: { name: "asc" } },
    select: { id: true, role: true, createdAt: true, makerspace: { select: { id: true, slug: true, name: true, logoUrl: true, status: true } } },
  });
  const managedMakerspaceIds = teams.filter((team) => team.role === MANAGER_ROLE).map((team) => team.makerspace.id);
  const managersByMakerspace = managedMakerspaceIds.length
    ? await prisma.teamMember.groupBy({ by: ["makerspaceId"], where: { makerspaceId: { in: managedMakerspaceIds }, role: MANAGER_ROLE }, _count: { _all: true } })
    : [];
  const managers = new Map(managersByMakerspace.map((group) => [group.makerspaceId, group._count._all]));

  return {
    teamMembers: teams.map(({ id, role, createdAt, makerspace: { id: makerspaceId, ...makerspace } }) => ({
      id,
      role,
      makerspace,
      joinedLabel: formatDate(createdAt, "UTC"),
      lastManager: role === MANAGER_ROLE && (managers.get(makerspaceId) ?? 0) <= 1,
    })),
  };
}
