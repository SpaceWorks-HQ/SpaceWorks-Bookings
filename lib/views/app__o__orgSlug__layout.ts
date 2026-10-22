import { loadPublicOrganisation } from "@/lib/publicOrganisation";

export async function loadPublicOrgLayout({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  return { org: await loadPublicOrganisation(orgSlug) };
}
