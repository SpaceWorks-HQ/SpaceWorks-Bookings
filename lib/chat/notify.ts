import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { enqueueOutbox, type OutboxClient } from "@/lib/outbox";
import { decryptOrgSecret } from "@/lib/orgSecrets";
import { CHAT_CONFIG_SCHEMAS, type ChatConfig } from "./config";
import { CHAT_EVENTS, type ChatEvent, type ChatKind } from "./events";
import { chatMessage, type ChatRefs } from "./message";
import { ChatGoneError, sendChatMessage } from "./send";

type ChatPayload = { channelId: string; organisationId: string; event: ChatEvent; refs: ChatRefs };
const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 64;

/** Queue an alert to every enabled channel of the organisation that asked for this event, in the caller's transaction. */
export async function queueChatAlerts(client: OutboxClient, organisationId: string, event: ChatEvent, refs: ChatRefs) {
  const channels = await client.chatChannel.findMany({ where: { organisationId, enabled: true, events: { has: event } }, select: { id: true } });
  for (const channel of channels) await enqueueOutbox(client, "chat-notice", { channelId: channel.id, organisationId, event, refs });
  return channels.length;
}

export function asChatPayload(value: Prisma.JsonValue): ChatPayload | null {
  const p = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  if (!p || !isId(p.channelId) || !isId(p.organisationId) || !CHAT_EVENTS.includes(p.event as ChatEvent)) return null;
  const refs = (p.refs && typeof p.refs === "object" && !Array.isArray(p.refs) ? p.refs : {}) as Record<string, unknown>;
  const clean: ChatRefs = {};
  for (const key of ["termId", "paymentId", "requestId"] as const) if (isId(refs[key])) clean[key] = refs[key] as string;
  if (typeof refs.month === "string" && /^\d{4}-\d{2}$/.test(refs.month)) clean.month = refs.month;
  return { channelId: p.channelId, organisationId: p.organisationId, event: p.event as ChatEvent, refs: clean };
}

export function readChannelConfig(channel: { kind: ChatKind; configEncrypted: string; organisationId: string }) {
  return CHAT_CONFIG_SCHEMAS[channel.kind].parse(JSON.parse(decryptOrgSecret(channel.configEncrypted, channel.organisationId, "chat"))) as ChatConfig[ChatKind];
}

/**
 * Send one queued alert. A channel the provider no longer accepts is switched off and its error kept for the
 * settings page; anything else is thrown so the queue retries with backoff.
 */
export async function deliverChatNotice(payload: ChatPayload): Promise<"sent" | "dropped"> {
  const channel = await prisma.chatChannel.findFirst({ where: { id: payload.channelId, organisationId: payload.organisationId } });
  if (!channel?.enabled) return "dropped";
  const text = await chatMessage(payload.organisationId, payload.event, payload.refs, channel.includeNames);
  if (!text) return "dropped";
  try {
    await sendChatMessage(channel.kind, readChannelConfig(channel), text);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "Sending failed.";
    const gone = error instanceof ChatGoneError;
    await prisma.chatChannel.update({ where: { id: channel.id }, data: { lastError: message, failures: { increment: 1 }, ...(gone ? { enabled: false } : {}) } });
    if (gone) return "dropped";
    throw error;
  }
  await prisma.chatChannel.update({ where: { id: channel.id }, data: { lastDeliveredAt: new Date(), lastError: null, failures: 0 } });
  return "sent";
}
