import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const PAGE_SIZE = 24;

/** Public, active organisations people can find and book. Unlisted ones never appear here. */
export async function loadOrganisationsDirectory({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const search = await searchParams;
  const q = (search.q ?? "").trim().slice(0, 80);
  const page = Math.max(1, Math.min(500, Number.parseInt(search.page ?? "1", 10) || 1));
  const where: Prisma.OrganisationWhereInput = {
    status: "ACTIVE",
    visibility: "PUBLIC",
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { kind: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [total, organisations] = await Promise.all([
    prisma.organisation.count({ where }),
    prisma.organisation.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { slug: true, name: true, kind: true, city: true, stateCode: true, description: true, logoUrl: true },
    }),
  ]);
  return { q, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total, organisations };
}
