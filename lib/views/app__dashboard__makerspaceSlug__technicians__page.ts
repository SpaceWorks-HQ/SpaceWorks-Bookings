import { prisma } from "@/lib/db";
import { requireMakerspaceCapability } from "@/lib/permissions";
import { makerspaceSummary } from "@/lib/bookings/staffView";

/** The technician directory (`repairs.manage`), with team members who have the technician role but no entry yet. */
export async function loadTechnicians({ params }: { params: Promise<{ makerspaceSlug: string }> }) {
  const { makerspaceSlug } = await params;
  const { makerspace } = await requireMakerspaceCapability(makerspaceSlug, "repairs.manage");
  const [technicians, members] = await Promise.all([
    prisma.technician.findMany({ where: { makerspaceId: makerspace.id }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
    prisma.teamMember.findMany({ where: { makerspaceId: makerspace.id, role: "TECHNICIAN" }, select: { userId: true, user: { select: { name: true, email: true } } } }),
  ]);
  const listed = new Set(technicians.flatMap((row) => (row.userId ? [row.userId] : [])));
  return {
    makerspace: await makerspaceSummary(makerspace.id),
    technicians: technicians.map((row) => ({
      id: row.id, kind: row.kind, name: row.name, email: row.email ?? "", phone: row.phone ?? "", whatsapp: row.whatsapp ?? "", telegramChatId: row.telegramChatId ?? "",
      skills: row.skills, preferredChannel: row.preferredChannel, notes: row.notes, active: row.active,
    })),
    unlisted: members.filter((member) => !listed.has(member.userId)).map((member) => ({ userId: member.userId, name: member.user.name || member.user.email || "Team member" })),
  };
}
