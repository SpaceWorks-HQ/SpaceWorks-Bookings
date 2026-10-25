import type { Prisma } from "@prisma/client";
import { MANAGER_ROLE } from "@/lib/permissionRoles";

/**
 * Every makerspace keeps at least one bookings manager (owner decision, 2026-10-24): removing, demoting or leaving
 * as the last one is refused. Callers run this inside their transaction; locking the makerspace row first
 * serialises concurrent team changes, so two managers cannot both step down at once.
 */
export const LAST_MANAGER_MESSAGE = "A makerspace needs at least one bookings manager. Make someone else a bookings manager first.";

/** Locks the makerspace's team and reads the member; `last` is true when they are its only bookings manager. */
export async function lockTeamMember(tx: Prisma.TransactionClient, makerspaceId: string, userId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Makerspace" WHERE "id" = ${makerspaceId} FOR UPDATE`;
  const member = await tx.teamMember.findUnique({ where: { userId_makerspaceId: { userId, makerspaceId } }, select: { id: true, role: true } });
  if (!member) return null;
  const last = member.role === MANAGER_ROLE && (await tx.teamMember.count({ where: { makerspaceId, role: MANAGER_ROLE } })) === 1;
  return { ...member, last };
}
