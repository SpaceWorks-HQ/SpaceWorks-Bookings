import { prisma } from "@/lib/db";
import { requireMakerspaceCapability } from "@/lib/permissions";
import { makerspaceSummary } from "@/lib/bookings/staffView";
import { WEBHOOK_EVENTS } from "@/lib/integrations/webhooks/events";

/** API keys, webhook endpoints and recent deliveries (`integrations.manage`). Secrets never leave the server. */
export async function loadIntegrations({ params }: { params: Promise<{ makerspaceSlug: string }> }) {
  const { makerspaceSlug } = await params;
  const { makerspace } = await requireMakerspaceCapability(makerspaceSlug, "integrations.manage");
  const [keys, endpoints, deliveries] = await Promise.all([
    prisma.apiKey.findMany({ where: { makerspaceId: makerspace.id }, orderBy: [{ revokedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }], select: { id: true, name: true, prefix: true, scopes: true, lastUsedAt: true, revokedAt: true, createdAt: true } }),
    prisma.webhookEndpoint.findMany({ where: { makerspaceId: makerspace.id }, orderBy: { createdAt: "asc" }, select: { id: true, url: true, description: true, events: true, isActive: true, consecutiveFailures: true, disabledAt: true, createdAt: true } }),
    prisma.webhookDelivery.findMany({ where: { makerspaceId: makerspace.id }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, endpointId: true, event: true, status: true, attempts: true, responseStatus: true, lastError: true, createdAt: true, deliveredAt: true, nextAttemptAt: true } }),
  ]);
  const iso = (value: Date | null) => value?.toISOString() ?? null;
  return {
    makerspace: await makerspaceSummary(makerspace.id),
    events: [...WEBHOOK_EVENTS],
    keys: keys.map((key) => ({ ...key, lastUsedAt: iso(key.lastUsedAt), revokedAt: iso(key.revokedAt), createdAt: key.createdAt.toISOString() })),
    endpoints: endpoints.map((endpoint) => ({ ...endpoint, disabledAt: iso(endpoint.disabledAt), createdAt: endpoint.createdAt.toISOString() })),
    deliveries: deliveries.map((delivery) => ({ ...delivery, createdAt: delivery.createdAt.toISOString(), deliveredAt: iso(delivery.deliveredAt), nextAttemptAt: iso(delivery.nextAttemptAt) })),
  };
}

export type IntegrationsView = Awaited<ReturnType<typeof loadIntegrations>>;
