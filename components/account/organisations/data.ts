import "server-only";

import type { OrganisationStatus, TeamRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format/datetime";

export type AccountMembershipRow = {
  id: string;
  organisation: { slug: string; name: string; logoUrl: string | null; status: OrganisationStatus };
  role: TeamRole;
  joinedLabel: string;
  /** The only OWNER left; leaving would orphan the organisation. */
  soleOwner: boolean;
};

export type AccountOrganisationsData = {
  teamMembers: AccountMembershipRow[];
};

/** The organisation teams one user is on. Selects are explicit: other people are never read. */
export async function loadAccountOrganisations(userId: string): Promise<AccountOrganisationsData> {
  const teams = await prisma.teamMember.findMany({
    where: { userId },
    orderBy: { organisation: { name: "asc" } },
    select: { id: true, role: true, createdAt: true, organisation: { select: { id: true, slug: true, name: true, logoUrl: true, status: true } } },
  });
  const ownedOrgIds = teams.filter((team) => team.role === "OWNER").map((team) => team.organisation.id);
  const ownersByOrg = ownedOrgIds.length
    ? await prisma.teamMember.groupBy({ by: ["organisationId"], where: { organisationId: { in: ownedOrgIds }, role: "OWNER" }, _count: { _all: true } })
    : [];
  const owners = new Map(ownersByOrg.map((group) => [group.organisationId, group._count._all]));

  return {
    teamMembers: teams.map(({ id, role, createdAt, organisation: { id: organisationId, ...organisation } }) => ({
      id,
      role,
      organisation,
      joinedLabel: formatDate(createdAt, "UTC"),
      soleOwner: role === "OWNER" && (owners.get(organisationId) ?? 0) <= 1,
    })),
  };
}
