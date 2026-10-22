import { requireSuperAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { isNewUserRegistrationEnabled } from "@/lib/instanceSettings";

export async function loadSuperAdminAuthView() {
  await requireSuperAdmin();
  const [accountsCount, sessionsCount, tokensCount, accountCreationEnabled] = await Promise.all([
    prisma.account.count(),
    prisma.session.count(),
    prisma.verificationToken.count(),
    isNewUserRegistrationEnabled(),
  ]);
  const [accounts, sessions, tokens] = await Promise.all([
    prisma.account.findMany({
      orderBy: { id: "desc" },
      take: 50,
      select: {
        id: true,
        provider: true,
        type: true,
        providerAccountId: true,
        user: { select: { id: true, email: true } },
      },
    }),
    prisma.session.findMany({
      orderBy: { expires: "desc" },
      take: 50,
      select: {
        id: true,
        expires: true,
        user: { select: { id: true, email: true } },
      },
    }),
    prisma.verificationToken.findMany({
      orderBy: { expires: "desc" },
      take: 50,
      select: { identifier: true, expires: true },
    }),
  ]);
  return { accountsCount, sessionsCount, tokensCount, accountCreationEnabled, accounts, sessions, tokens };
}
