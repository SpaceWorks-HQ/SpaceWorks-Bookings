import { loadPublicMakerspace } from "@/lib/publicMakerspace";

export async function loadPublicMakerspaceLayout({ params }: { params: Promise<{ makerspaceSlug: string }> }) {
  const { makerspaceSlug } = await params;
  return { makerspace: await loadPublicMakerspace(makerspaceSlug) };
}
