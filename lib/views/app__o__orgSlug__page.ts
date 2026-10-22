import { prisma } from "@/lib/db";
import { loadPublicOrganisation } from "@/lib/publicOrganisation";
import { loadStoredPage } from "@/lib/publicPage/server";

/**
 * The public page: the organisation's story and the plans people can join. With a published custom page
 * its sections render; otherwise the plain page shows.
 */
export async function loadPublicOrgPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const org = await loadPublicOrganisation(orgSlug);
  const [plans, stored] = await Promise.all([
    prisma.membershipPlan.findMany({
      where: { organisationId: org.id, archivedAt: null },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true, name: true, slug: true, description: true, currency: true, durationType: true, durationMonths: true, fixedEndDate: true,
        priceNewMinor: true, priceRenewalMinor: true, joiningFeeMinor: true, joinMode: true, allUnits: true,
        units: { select: { unit: { select: { name: true } } } },
      },
    }),
    loadStoredPage(org.id),
  ]);
  const page = stored.published;
  const units = page?.sections.some((section) => section.type === "units" && section.visible)
    ? await prisma.orgUnit.findMany({ where: { organisationId: org.id, archivedAt: null }, orderBy: [{ level: "asc" }, { sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, level: true, parentId: true }, take: 500 })
    : [];
  return { org, plans, takingMembers: org.status === "ACTIVE", page, units };
}
