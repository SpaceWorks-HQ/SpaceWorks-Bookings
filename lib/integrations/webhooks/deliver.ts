import "server-only";

import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { assertPublicHost } from "@/lib/net/publicHost";
import { decryptMakerspaceSecret } from "@/lib/makerspaceSecrets";
import { nextAttemptAfter, signWebhook } from "./events";

/**
 * Deliver due webhooks: claim (lease) each due row, POST the JSON with its signature to a public host only (no
 * redirects, 10 s timeout), then record the outcome. 2xx is delivered; anything else retries on RETRY_DELAYS_MS and
 * fails after the last. An endpoint failing DISABLE_AFTER deliveries in a row is switched off and audited.
 */

const LEASE_MS = 2 * 60_000;
const BATCH = 50;
export const DISABLE_AFTER = 25;

async function claim(now: Date) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "WebhookDelivery" WHERE "status" = 'PENDING' AND "nextAttemptAt" <= ${now}
      ORDER BY "nextAttemptAt" LIMIT ${BATCH} FOR UPDATE SKIP LOCKED`;
    if (rows.length) await tx.webhookDelivery.updateMany({ where: { id: { in: rows.map((row) => row.id) } }, data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS) } });
    return rows.map((row) => row.id);
  });
}

async function post(url: string, secret: string, delivery: { id: string; event: string; payload: unknown }, now: Date): Promise<{ status: number | null; error: string }> {
  try {
    const target = new URL(url);
    if (target.protocol !== "https:" && target.protocol !== "http:") return { status: null, error: "Only http and https URLs can receive webhooks." };
    await assertPublicHost(target.hostname);
    const body = JSON.stringify(delivery.payload);
    const response = await fetch(target, {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000), body,
      headers: { "content-type": "application/json", "user-agent": "SpaceWorks-Bookings-Webhooks/1", "x-spaceworks-event": delivery.event, "x-spaceworks-delivery": delivery.id, "x-spaceworks-signature": signWebhook(secret, body, Math.floor(now.getTime() / 1000)) },
    });
    await response.body?.cancel().catch(() => undefined);
    return { status: response.status, error: response.ok ? "" : `The endpoint answered ${response.status}.` };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return { status: null, error: name === "PrivateHostError" ? "The URL points at a private address." : name === "TimeoutError" ? "The endpoint didn't answer within 10 seconds." : "The endpoint couldn't be reached." };
  }
}

export async function deliverOne(deliveryId: string, now = new Date()) {
  const delivery = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId }, include: { endpoint: true } });
  if (!delivery || delivery.status !== "PENDING") return null;
  const { endpoint } = delivery;
  const outcome = endpoint.isActive
    ? await post(endpoint.url, decryptMakerspaceSecret(endpoint.secretEncrypted, endpoint.makerspaceId, "webhook"), delivery, now)
    : { status: null, error: "The endpoint is switched off." };
  const ok = outcome.status !== null && outcome.status >= 200 && outcome.status < 300;
  const attempts = delivery.attempts + 1;
  const next = ok || !endpoint.isActive ? null : nextAttemptAfter(attempts, now);
  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: { attempts, responseStatus: outcome.status, lastError: outcome.error.slice(0, 300), status: ok ? "DELIVERED" : next ? "PENDING" : "FAILED", deliveredAt: ok ? now : null, nextAttemptAt: next },
  });
  if (ok) {
    if (endpoint.consecutiveFailures) await prisma.webhookEndpoint.update({ where: { id: endpoint.id }, data: { consecutiveFailures: 0 } });
  } else if (endpoint.isActive) {
    const failures = endpoint.consecutiveFailures + 1;
    const disable = failures >= DISABLE_AFTER;
    await prisma.webhookEndpoint.update({ where: { id: endpoint.id }, data: { consecutiveFailures: failures, ...(disable ? { isActive: false, disabledAt: now } : {}) } });
    if (disable) await recordAuditEvent({ action: "WEBHOOK_ENDPOINT_DISABLED", actorUserId: null, makerspaceId: endpoint.makerspaceId, targetType: "WebhookEndpoint", targetId: endpoint.id, metadata: { failures } });
  }
  return { ok, status: outcome.status, error: outcome.error };
}

/** Job: deliver every due webhook (several workers may run it; leases keep them apart). */
export async function deliverDueWebhooks(now = new Date()): Promise<number> {
  let delivered = 0;
  for (const id of await claim(now)) {
    try {
      if ((await deliverOne(id, now))?.ok) delivered += 1;
    } catch {
      console.error("[webhooks] a delivery could not be attempted");
    }
  }
  return delivered;
}
