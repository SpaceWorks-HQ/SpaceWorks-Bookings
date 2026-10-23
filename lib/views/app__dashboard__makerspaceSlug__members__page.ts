import { prisma } from "@/lib/db";
import { requireMakerspaceCapability } from "@/lib/permissions";
import { makerspaceSummary, pageNumber, type DirectoryProps } from "@/lib/bookings/staffView";

export async function loadMembers({ params, searchParams }: DirectoryProps) {
  const { makerspaceSlug } = await params;
  const { makerspace } = await requireMakerspaceCapability(makerspaceSlug, "members.manage");
  const search = await searchParams;
  const q = (search.q ?? "").trim().slice(0, 100);
  const page = pageNumber(search.page);
  const where = { makerspaceId: makerspace.id, ...(q ? { OR: [{ email: { contains: q, mode: "insensitive" as const } }, { name: { contains: q, mode: "insensitive" as const } }] } : {}) };
  const [members, total] = await Promise.all([
    prisma.makerspaceMember.findMany({ where, orderBy: [{ email: "asc" }, { id: "asc" }], skip: (page - 1) * 50, take: 50,
      select: { id: true, email: true, name: true, active: true, validUntil: true, note: true } }),
    prisma.makerspaceMember.count({ where }),
  ]);
  return { makerspace: await makerspaceSummary(makerspace.id), members: members.map((row) => ({ ...row, validUntil: row.validUntil?.toISOString().slice(0, 10) ?? null })),
    q, page, pages: Math.max(1, Math.ceil(total / 50)) };
}
