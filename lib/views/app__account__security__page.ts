import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { SECURITY_ACTIVITY_ACTIONS, SECURITY_ACTIVITY_LIMIT } from "@/lib/accountSecurity";

export async function loadAccountSecurityView() {
  const session = await requireAuth();
  const userId = session.user.id;
  const [user, accounts, activity, staffRoles] = await Promise.all([
    // passwordHash is read only to derive a boolean; it never reaches the browser.
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { mfaEnabledAt: true, passwordHash: true, isSuperAdmin: true } }),
    prisma.account.findMany({ where: { userId }, select: { provider: true }, orderBy: { provider: "asc" } }),
    // The person's own security events only; metadata is never selected.
    prisma.auditEvent.findMany({
      where: { actorUserId: userId, action: { in: SECURITY_ACTIVITY_ACTIONS } },
      select: { id: true, action: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: SECURITY_ACTIVITY_LIMIT,
    }),
    prisma.teamMember.count({ where: { userId } }),
  ]);
  const hasPassword = Boolean(user.passwordHash);
  const providers = [...new Set(accounts.map((account) => account.provider))];
  // Staff must use an authenticator app before the dashboard opens; members never need one.
  const authenticatorRequired = staffRoles > 0 && !user.mfaEnabledAt;
  return { hasPassword, superAdmin: user.isSuperAdmin, authenticatorRequired, isStaff: staffRoles > 0, user: { mfaEnabledAt: user.mfaEnabledAt }, providers, activity };
}
