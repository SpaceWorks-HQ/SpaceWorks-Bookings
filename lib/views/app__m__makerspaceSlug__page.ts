import { loadPublicMakerspace } from "@/lib/publicMakerspace";
import { prisma } from "@/lib/db";

/** The public makerspace page: who they are and how to reach them. Phase 1 adds the spaces to book. */
export async function loadPublicMakerspacePage({ params }: { params: Promise<{ makerspaceSlug: string }> }) {
  const { makerspaceSlug } = await params;
  const makerspace = await loadPublicMakerspace(makerspaceSlug);
  const spaces = await prisma.space.findMany({ where: { makerspaceId: makerspace.id, published: true, archivedAt: null },
    include: { photos: { orderBy: { sortOrder: "asc" }, take: 1 } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  return { makerspace, spaces, takingBookings: makerspace.status === "ACTIVE" };
}
