import { loadPublicMakerspace } from "@/lib/publicMakerspace";

export async function loadFindBookingPage({ params }: { params: Promise<{ makerspaceSlug: string }> }) {
  return { makerspace: await loadPublicMakerspace((await params).makerspaceSlug) };
}
