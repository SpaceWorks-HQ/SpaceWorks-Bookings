"use server";

import { z } from "zod";
import { staffAction } from "@/lib/actions/bookingContext";
import { id, makerspaceSlug } from "@/lib/actions/bookingInputs";
import { API_SCOPES, createApiKey as createKey, revokeApiKey as revokeKey } from "@/lib/integrations/apiKeys";
import * as endpoints from "@/lib/integrations/webhooks/endpoints";
import { notFound } from "@/lib/bookings/errors";

/** API keys and webhooks (`integrations.manage`). Keys and signing secrets are returned once and never again. */

const keySchema = z.object({ makerspaceSlug, name: z.string().trim().min(1, "Name the key").max(80), scopes: z.array(z.enum(API_SCOPES)).min(1, "Choose a scope") }).strict();
const keyIdSchema = z.object({ makerspaceSlug, keyId: id }).strict();
const endpointInput = z.object({ makerspaceSlug, url: z.string(), description: z.string().optional(), events: z.array(z.string()) }).strict();
const endpointUpdate = endpointInput.extend({ endpointId: id, active: z.boolean() }).strict();
const endpointIdSchema = z.object({ makerspaceSlug, endpointId: id }).strict();

export async function createApiKey(input: unknown) {
  return staffAction(keySchema, input, "integrations.manage", (data, ctx) => createKey({ makerspaceId: ctx.makerspaceId, name: data.name, scopes: data.scopes, actorUserId: ctx.actor.userId }));
}

export async function revokeApiKey(input: unknown) {
  return staffAction(keyIdSchema, input, "integrations.manage", async (data, ctx) => {
    if (!(await revokeKey({ makerspaceId: ctx.makerspaceId, keyId: data.keyId, actorUserId: ctx.actor.userId }))) throw notFound("Key");
  });
}

export async function createWebhookEndpoint(input: unknown) {
  return staffAction(endpointInput, input, "integrations.manage", (data, ctx) => endpoints.createEndpoint({ makerspaceId: ctx.makerspaceId, actorUserId: ctx.actor.userId, endpoint: { url: data.url, description: data.description, events: data.events } }));
}

export async function updateWebhookEndpoint(input: unknown) {
  return staffAction(endpointUpdate, input, "integrations.manage", (data, ctx) => endpoints.updateEndpoint({ makerspaceId: ctx.makerspaceId, actorUserId: ctx.actor.userId, endpointId: data.endpointId, active: data.active, endpoint: { url: data.url, description: data.description, events: data.events } }));
}

export async function rotateWebhookSecret(input: unknown) {
  return staffAction(endpointIdSchema, input, "integrations.manage", (data, ctx) => endpoints.rotateEndpointSecret({ makerspaceId: ctx.makerspaceId, actorUserId: ctx.actor.userId, endpointId: data.endpointId }));
}

export async function deleteWebhookEndpoint(input: unknown) {
  return staffAction(endpointIdSchema, input, "integrations.manage", (data, ctx) => endpoints.deleteEndpoint({ makerspaceId: ctx.makerspaceId, actorUserId: ctx.actor.userId, endpointId: data.endpointId }));
}

export async function pingWebhookEndpoint(input: unknown) {
  return staffAction(endpointIdSchema, input, "integrations.manage", (data, ctx) => endpoints.pingEndpoint({ makerspaceId: ctx.makerspaceId, endpointId: data.endpointId }));
}
