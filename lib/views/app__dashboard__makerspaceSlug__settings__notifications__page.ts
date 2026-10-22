import { prisma } from "@/lib/db";
import { requireMakerspaceCapability } from "@/lib/permissions";
import { paymentSecretsConfigured } from "@/lib/payments/secrets";

/** The makerspace's chat channels: where each posts (never its secret) and how its last delivery went. */
export async function loadMakerspaceNotificationsView({ params }: { params: Promise<{ makerspaceSlug: string }> }) {
  const { makerspaceSlug } = await params;
  const { makerspace: current } = await requireMakerspaceCapability(makerspaceSlug, "makerspace.settings");
  const [makerspace, channels] = await Promise.all([
    prisma.makerspace.findUniqueOrThrow({ where: { id: current.id }, select: { name: true, slug: true, logoUrl: true, timezone: true } }),
    prisma.chatChannel.findMany({
      where: { makerspaceId: current.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, kind: true, name: true, target: true, events: true, includeNames: true, enabled: true, lastDeliveredAt: true, lastError: true },
    }),
  ]);
  return { makerspace, canEdit: true, secretsReady: paymentSecretsConfigured(), channels };
}
