import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/** A team member's reach: the whole organisation, or one unit and everything under it. */
export type TeamScope = { organisationId: string; unitId: string | null; unitPath: string | null };

export async function teamScope(organisationId: string, unitId: string | null): Promise<TeamScope> {
  if (!unitId) return { organisationId, unitId: null, unitPath: null };
  const unit = await prisma.orgUnit.findFirst({ where: { organisationId, id: unitId }, select: { path: true } });
  // A scope pointing at a missing unit sees nothing rather than everything.
  return { organisationId, unitId, unitPath: unit?.path ?? "__missing__" };
}

/** Members a scoped manager may see: their unit's subtree only. Org-wide scope sees every member. */
export function memberWhere(scope: TeamScope): Prisma.MemberWhereInput {
  if (!scope.unitPath) return { organisationId: scope.organisationId };
  return { organisationId: scope.organisationId, unit: { is: { OR: [{ path: scope.unitPath }, { path: { startsWith: `${scope.unitPath}/` } }] } } };
}

/** Whether a unit sits inside a scope (a scoped manager may only place members there). */
export function unitInScope(scope: TeamScope, unitPath: string | null): boolean {
  if (!scope.unitPath) return true;
  if (!unitPath) return false;
  return unitPath === scope.unitPath || unitPath.startsWith(`${scope.unitPath}/`);
}
