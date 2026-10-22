import { prisma } from "@/lib/db";

/** Listed, active makerspaces for the sitemap. Unlisted ones stay out of search engines. */
export async function loadSitemapMakerspaces() {
  return prisma.makerspace.findMany({
    where: { status: "ACTIVE", visibility: "PUBLIC" },
    orderBy: { slug: "asc" },
    take: 5000,
    select: { slug: true, updatedAt: true },
  });
}
