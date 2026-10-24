import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";

export async function loadDashboardView() {
  const session = await requireAuth();
  const teams = await prisma.teamMember.findMany({
    where: { userId: session.user.id },
    orderBy: { makerspace: { name: "asc" } },
    select: { role: true, makerspace: { select: { slug: true, name: true, logoUrl: true, status: true, kind: true } } },
    take: 50,
  });
  const fullName = session.user.name?.trim() || "there";
  return { firstName: fullName.split(/\s+/)[0], teams: teams.map(({ role, makerspace }) => ({ role, ...makerspace })) };
}
