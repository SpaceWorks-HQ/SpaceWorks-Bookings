import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadPublicMakerspace } from "@/lib/publicMakerspace";
import { loadRules } from "@/lib/availability/context";
import { bookingDate } from "@/lib/bookings/publicUi";

export async function loadPublicSpacePage({ params }: { params: Promise<{ makerspaceSlug: string; spaceSlug: string }> }) {
  const { makerspaceSlug, spaceSlug } = await params;
  const makerspace = await loadPublicMakerspace(makerspaceSlug);
  const space = await prisma.space.findFirst({ where: { makerspaceId: makerspace.id, slug: spaceSlug, published: true, archivedAt: null }, include: { photos: { orderBy: { sortOrder: "asc" } } } });
  if (!space) notFound();
  const [rules, addOns, session] = await Promise.all([loadRules(prisma, makerspace.id, space),
    prisma.addOn.findMany({ where: { makerspaceId: makerspace.id, active: true, OR: [{ spaceId: null }, { spaceId: space.id }] }, orderBy: { sortOrder: "asc" } }), auth()]);
  return { makerspace, space, rules: rules.values, addOns, signedIn: Boolean(session?.user?.id),
    contact: { name: session?.user?.name ?? "", email: session?.user?.email ?? "" }, today: bookingDate(new Date(), makerspace.timezone) };
}
