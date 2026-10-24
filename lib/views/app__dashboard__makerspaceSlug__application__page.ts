import { prisma } from "@/lib/db";
import { can, requireMakerspaceTeam } from "@/lib/permissions";
import { canResubmit } from "@/lib/makerspaceLifecycle";

/** The makerspace's application and lifecycle, for its own team, whatever its status. */
export async function loadMakerspaceApplicationView({ params }: { params: Promise<{ makerspaceSlug: string }> }) {
  const { makerspaceSlug } = await params;
  const { makerspace, membership } = await requireMakerspaceTeam(makerspaceSlug);
  const [details, reviews] = await Promise.all([
    prisma.makerspace.findUniqueOrThrow({
      where: { id: makerspace.id },
      select: {
        name: true, slug: true, status: true, kind: true, description: true, contactEmail: true, contactPhone: true,
        website: true, addressLine: true, city: true, stateCode: true, postalCode: true, createdAt: true,
      },
    }),
    prisma.makerspaceReview.findMany({
      where: { makerspaceId: makerspace.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      // Platform admins are not named to applicants: the history says what happened, not who.
      select: { id: true, action: true, reason: true, createdAt: true },
    }),
  ]);
  const latestNote = reviews.find((review) => review.reason)?.reason ?? null;
  return {
    makerspace: details,
    reviews,
    latestNote,
    canEdit: can(membership.role, "makerspace.settings") && canResubmit(details.status),
    isManager: can(membership.role, "makerspace.settings"),
  };
}
