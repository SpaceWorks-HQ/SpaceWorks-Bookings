import { prisma } from "@/lib/db";
import { requireOrgCapability } from "@/lib/permissions";

/** The organisation's units (as a tree, with member counts) and its member roles. */
export async function loadOrgStructureView({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { organisation, membership } = await requireOrgCapability(orgSlug, "org.settings");
  const [org, units, roles, unitCounts, roleCounts] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: organisation.id }, select: { name: true, slug: true, logoUrl: true, unitLevels: true } }),
    prisma.orgUnit.findMany({ where: { organisationId: organisation.id }, orderBy: [{ path: "asc" }], select: { id: true, name: true, slug: true, level: true, path: true, parentId: true, archivedAt: true } }),
    prisma.memberRole.findMany({ where: { organisationId: organisation.id }, orderBy: [{ archivedAt: "asc" }, { sortOrder: "asc" }], select: { id: true, name: true, description: true, color: true, unitId: true, archivedAt: true } }),
    prisma.member.groupBy({ by: ["unitId"], where: { organisationId: organisation.id, unitId: { not: null } }, _count: { _all: true } }),
    prisma.memberRoleAssignment.groupBy({ by: ["roleId"], where: { organisationId: organisation.id }, _count: { _all: true } }),
  ]);
  const membersByUnit = new Map(unitCounts.map((row) => [row.unitId!, row._count._all]));
  const membersByRole = new Map(roleCounts.map((row) => [row.roleId, row._count._all]));
  // Depth-first order by name within each parent, so the tree reads naturally.
  const children = new Map<string | null, typeof units>();
  for (const unit of units) children.set(unit.parentId, [...(children.get(unit.parentId) ?? []), unit]);
  const ordered: Array<(typeof units)[number] & { members: number }> = [];
  const visit = (parentId: string | null) => {
    for (const unit of [...(children.get(parentId) ?? [])].sort((a, b) => a.name.localeCompare(b.name))) {
      ordered.push({ ...unit, members: membersByUnit.get(unit.id) ?? 0 });
      visit(unit.id);
    }
  };
  visit(null);
  return {
    org,
    canEdit: !membership.unitId,
    units: ordered,
    roles: roles.map((role) => ({ ...role, members: membersByRole.get(role.id) ?? 0 })),
  };
}
