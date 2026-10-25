import { prisma } from "@/lib/db";
import { requireMakerspaceCapability } from "@/lib/permissions";
import { makerspaceSummary, pageNumber, type DirectoryProps } from "@/lib/bookings/staffView";

export async function loadSpaces({ params, searchParams }: DirectoryProps) {
  const { makerspaceSlug } = await params;
  const { makerspace } = await requireMakerspaceCapability(makerspaceSlug, "spaces.manage");
  const search = await searchParams;
  const status = ["published", "draft", "archived"].includes(search.status ?? "") ? search.status! : "all";
  const page = pageNumber(search.page);
  const where = { makerspaceId: makerspace.id, ...(status === "archived" ? { archivedAt: { not: null } } : status === "all" ? {} : { archivedAt: null, published: status === "published" }) };
  const [rows, total] = await Promise.all([
    prisma.space.findMany({ where, orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }], skip: (page - 1) * 50, take: 50,
      select: { id: true, name: true, kind: true, capacity: true, units: true, published: true, archivedAt: true } }),
    prisma.space.count({ where }),
  ]);
  return { makerspace: await makerspaceSummary(makerspace.id), rows: rows.map((row) => ({ ...row, archivedAt: row.archivedAt?.toISOString() ?? null })), status, page, pages: Math.max(1, Math.ceil(total / 50)) };
}
