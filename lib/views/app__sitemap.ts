import { prisma } from "@/lib/db";

/** Listed, active organisations for the sitemap. Unlisted ones stay out of search engines. */
export async function loadSitemapOrganisations() {
  return prisma.organisation.findMany({
    where: { status: "ACTIVE", visibility: "PUBLIC" },
    orderBy: { slug: "asc" },
    take: 5000,
    select: { slug: true, updatedAt: true },
  });
}
