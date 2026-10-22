import "server-only";

import { prisma } from "@/lib/db";

export type InviteAcceptance =
  | { ok: true; href: string }
  | { ok: false; reason: "unavailable" | "wrong-account" };

/**
 * Join a makerspace's team with a single-use invite. Invites the platform super-admin sends when it
 * creates a makerspace are bound to one email address; only that verified account may accept.
 */
export async function acceptMakerspaceInviteToken(token: string, user: { id: string; email: string | null; emailVerified: boolean }): Promise<InviteAcceptance> {
  return prisma.$transaction(async (tx) => {
    const invite = await tx.teamInvite.findUnique({
      where: { token },
      select: { id: true, role: true, email: true, makerspaceId: true, usedAt: true, expiresAt: true, makerspace: { select: { slug: true } } },
    });
    const now = new Date();
    if (!invite || invite.usedAt || (invite.expiresAt && invite.expiresAt <= now)) return { ok: false, reason: "unavailable" };
    if (invite.email && (!user.emailVerified || !user.email || invite.email.trim().toLowerCase() !== user.email.trim().toLowerCase())) {
      return { ok: false, reason: "wrong-account" };
    }
    const claim = await tx.teamInvite.updateMany({
      where: { id: invite.id, usedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      data: { usedAt: now, usedByUserId: user.id },
    });
    if (claim.count !== 1) return { ok: false, reason: "unavailable" };
    await tx.teamMember.upsert({
      where: { userId_makerspaceId: { userId: user.id, makerspaceId: invite.makerspaceId } },
      create: { userId: user.id, makerspaceId: invite.makerspaceId, role: invite.role },
      update: {},
    });
    await tx.auditEvent.create({ data: { action: "TEAM_INVITE_ACCEPTED", actorUserId: user.id, makerspaceId: invite.makerspaceId, targetType: "TeamInvite", targetId: invite.id } });
    return { ok: true, href: `/dashboard/${invite.makerspace.slug}` };
  });
}
