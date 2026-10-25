import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { canDeleteMakerspace, requireMakerspaceRole } from "@/lib/permissions";
type Props = { params: Promise<{ makerspaceSlug: string; }>; };

export async function loadMakerspaceSettingsView({ params }: Props) {

  const { makerspaceSlug } = await params;
  const { makerspace: current, membership } = await requireMakerspaceRole(makerspaceSlug, "BOOKINGS_MANAGER");

  const makerspace = await prisma.makerspace.findUnique({
    where: { id: current.id },
    select: { name: true, description: true, logoUrl: true, slug: true },
  });

  if (!makerspace) notFound();

  const canDelete = canDeleteMakerspace(membership);
  return { makerspace, membership, canDelete };
}
