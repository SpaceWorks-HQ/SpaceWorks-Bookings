import { loadPublicOrganisation } from "@/lib/publicOrganisation";

/** The public makerspace page: who they are and how to reach them. Phase 1 adds the spaces to book. */
export async function loadPublicOrgPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const org = await loadPublicOrganisation(orgSlug);
  return { org, takingBookings: org.status === "ACTIVE" };
}
