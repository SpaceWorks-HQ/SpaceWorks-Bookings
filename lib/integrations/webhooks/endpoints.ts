import "server-only";

import crypto from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { assertPublicHost } from "@/lib/net/publicHost";
import { encryptMakerspaceSecret } from "@/lib/makerspaceSecrets";
import { invalidInput, notFound, zodInputError } from "@/lib/bookings/errors";
import { WEBHOOK_EVENTS } from "./events";
import { deliverOne } from "./deliver";

/** Webhook endpoints of a makerspace (`integrations.manage`). Secrets are shown once, on create and on rotate. */

const MAX_ENDPOINTS = 10;
export const endpointSchema = z.object({
  url: z.string().trim().url("Enter a full URL").max(500).refine((value) => value.startsWith("https://") || (process.env.NODE_ENV !== "production" && value.startsWith("http://")), "Use an https:// URL"),
  description: z.string().trim().max(200).default(""),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Choose at least one event").max(WEBHOOK_EVENTS.length),
}).strict();

function parseEndpoint(value: unknown) {
  const parsed = endpointSchema.safeParse(value);
  if (!parsed.success) throw zodInputError(parsed.error.issues);
  return parsed.data;
}

const newSecret = () => `whsec_${crypto.randomBytes(32).toString("base64url")}`;

async function publicUrl(url: string) {
  try {
    await assertPublicHost(new URL(url).hostname);
  } catch {
    throw invalidInput("That URL points at a private or unknown address.", { url: "Use a public address" });
  }
}

export async function createEndpoint(input: { makerspaceId: string; actorUserId: string; endpoint: unknown }) {
  const parsed = parseEndpoint(input.endpoint);
  await publicUrl(parsed.url);
  if ((await prisma.webhookEndpoint.count({ where: { makerspaceId: input.makerspaceId } })) >= MAX_ENDPOINTS) throw invalidInput(`A makerspace can have up to ${MAX_ENDPOINTS} endpoints.`);
  const secret = newSecret();
  const endpoint = await prisma.webhookEndpoint.create({ data: { makerspaceId: input.makerspaceId, url: parsed.url, description: parsed.description, events: parsed.events, secretEncrypted: encryptMakerspaceSecret(secret, input.makerspaceId, "webhook"), createdById: input.actorUserId } });
  await recordAuditEvent({ action: "WEBHOOK_ENDPOINT_CREATED", actorUserId: input.actorUserId, makerspaceId: input.makerspaceId, targetType: "WebhookEndpoint", targetId: endpoint.id, metadata: { events: parsed.events.join(",") } });
  return { id: endpoint.id, secret };
}

async function owned(makerspaceId: string, endpointId: string) {
  const endpoint = await prisma.webhookEndpoint.findFirst({ where: { id: endpointId, makerspaceId } });
  if (!endpoint) throw notFound("Endpoint");
  return endpoint;
}

export async function updateEndpoint(input: { makerspaceId: string; actorUserId: string; endpointId: string; endpoint: unknown; active: boolean }) {
  const parsed = parseEndpoint(input.endpoint);
  const current = await owned(input.makerspaceId, input.endpointId);
  if (parsed.url !== current.url) await publicUrl(parsed.url);
  await prisma.webhookEndpoint.update({ where: { id: current.id }, data: { url: parsed.url, description: parsed.description, events: parsed.events, isActive: input.active, ...(input.active && !current.isActive ? { consecutiveFailures: 0, disabledAt: null } : {}) } });
  await recordAuditEvent({ action: "WEBHOOK_ENDPOINT_UPDATED", actorUserId: input.actorUserId, makerspaceId: input.makerspaceId, targetType: "WebhookEndpoint", targetId: current.id, metadata: { active: input.active } });
}

export async function rotateEndpointSecret(input: { makerspaceId: string; actorUserId: string; endpointId: string }) {
  const current = await owned(input.makerspaceId, input.endpointId);
  const secret = newSecret();
  await prisma.webhookEndpoint.update({ where: { id: current.id }, data: { secretEncrypted: encryptMakerspaceSecret(secret, input.makerspaceId, "webhook") } });
  await recordAuditEvent({ action: "WEBHOOK_SECRET_ROTATED", actorUserId: input.actorUserId, makerspaceId: input.makerspaceId, targetType: "WebhookEndpoint", targetId: current.id });
  return { secret };
}

export async function deleteEndpoint(input: { makerspaceId: string; actorUserId: string; endpointId: string }) {
  const current = await owned(input.makerspaceId, input.endpointId);
  await prisma.webhookEndpoint.delete({ where: { id: current.id } });
  await recordAuditEvent({ action: "WEBHOOK_ENDPOINT_DELETED", actorUserId: input.actorUserId, makerspaceId: input.makerspaceId, targetType: "WebhookEndpoint", targetId: current.id });
}

/** Send a `ping` now and report what the endpoint answered. */
export async function pingEndpoint(input: { makerspaceId: string; endpointId: string; now?: Date }) {
  const endpoint = await owned(input.makerspaceId, input.endpointId);
  const now = input.now ?? new Date();
  const eventId = `ping-${crypto.randomUUID()}`;
  const makerspace = await prisma.makerspace.findUniqueOrThrow({ where: { id: input.makerspaceId }, select: { slug: true } });
  const payload = { id: eventId, type: "ping", createdAt: now.toISOString(), makerspace: makerspace.slug, data: {} };
  const delivery = await prisma.webhookDelivery.create({ data: { makerspaceId: input.makerspaceId, endpointId: endpoint.id, event: "ping", eventId, payload: payload as Prisma.InputJsonValue, nextAttemptAt: null } });
  const outcome = await deliverOne(delivery.id, now);
  // A ping is tried once: don't leave it to retry.
  await prisma.webhookDelivery.updateMany({ where: { id: delivery.id, status: "PENDING" }, data: { status: "FAILED", nextAttemptAt: null } });
  return outcome ?? { ok: false, status: null, error: "The ping could not be sent." };
}
