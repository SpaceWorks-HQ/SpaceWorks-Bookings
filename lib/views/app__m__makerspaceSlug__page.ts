import { loadPublicMakerspace } from "@/lib/publicMakerspace";

/** The public makerspace page: who they are and how to reach them. Phase 1 adds the spaces to book. */
export async function loadPublicMakerspacePage({ params }: { params: Promise<{ makerspaceSlug: string }> }) {
  const { makerspaceSlug } = await params;
  const makerspace = await loadPublicMakerspace(makerspaceSlug);
  return { makerspace, takingBookings: makerspace.status === "ACTIVE" };
}
