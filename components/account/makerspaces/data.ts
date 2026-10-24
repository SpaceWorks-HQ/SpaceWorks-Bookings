import "server-only";

import type { MakerspaceStatus, TeamRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format/datetime";

export type AccountMembershipRow = {
  id: string;
  makerspace: { slug: string; name: string; logoUrl: string | null; status: MakerspaceStatus };
  role: TeamRole;
  joinedLabel: string;
  /** The only OWNER left; leaving would orphan the makerspace. */
  soleOwner: boolean;
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
  const ownedMakerspaceIds = teams.filter((team) => team.role === "OWNER").map((team) => team.makerspace.id);
  const ownersByMakerspace = ownedMakerspaceIds.length
    ? await prisma.teamMember.groupBy({ by: ["makerspaceId"], where: { makerspaceId: { in: ownedMakerspaceIds }, role: "OWNER" }, _count: { _all: true } })
    : [];
  const owners = new Map(ownersByMakerspace.map((group) => [group.makerspaceId, group._count._all]));

  return {
    teamMembers: teams.map(({ id, role, createdAt, makerspace: { id: makerspaceId, ...makerspace } }) => ({
      id,
      role,
      makerspace,
      joinedLabel: formatDate(createdAt, "UTC"),
      soleOwner: role === "OWNER" && (owners.get(makerspaceId) ?? 0) <= 1,
    })),
  };
}
