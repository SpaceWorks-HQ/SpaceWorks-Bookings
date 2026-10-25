import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { readChannelConfig } from "@/lib/chat/notify";
import { ChatGoneError, sendChatMessage } from "@/lib/chat/send";
import { SEVERITY_LABELS } from "@/lib/repairs/rules";
import { absoluteUrl, sendBrandedEmail } from "./message";

/**
 * Repair messages from the outbox. Payloads hold ids, the recipient and, for requests, the technician's link (those
 * rows are capabilities, deleted once sent). Text is built when sending, from the issue as it is then; a request
 * that has since closed is dropped rather than sent.
 */

const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 64;
const isUrl = (value: unknown): value is string => typeof value === "string" && value.length <= 2048 && /^https?:\/\//.test(value);
const record = (value: Prisma.JsonValue) => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

type RequestPayload = { makerspaceId: string; requestId: string; to?: string; channel?: "WHATSAPP" | "TELEGRAM"; url: string; notice: "request" | "assigned" };
type NoticePayload = { makerspaceId: string; issueId: string; to: string; notice: "reported" | "fixed" | "taken" };

export function asRepairRequestPayload(value: Prisma.JsonValue): RequestPayload | null {
  const p = record(value);
  if (!p || !isId(p.makerspaceId) || !isId(p.requestId) || !isUrl(p.url) || (p.notice !== "request" && p.notice !== "assigned")) return null;
  if (p.channel !== undefined && p.channel !== "WHATSAPP" && p.channel !== "TELEGRAM") return null;
  if (p.channel === undefined && (typeof p.to !== "string" || p.to.length > 320)) return null;
  return p as RequestPayload;
}

export function asRepairNoticePayload(value: Prisma.JsonValue): NoticePayload | null {
  const p = record(value);
  if (!p || !isId(p.makerspaceId) || !isId(p.issueId) || typeof p.to !== "string" || p.to.length > 320 || !["reported", "fixed", "taken"].includes(p.notice as string)) return null;
  return p as NoticePayload;
}

async function requestContext(payload: RequestPayload) {
  const request = await prisma.repairRequest.findFirst({
    where: { id: payload.requestId, makerspaceId: payload.makerspaceId },
    include: { technician: true, issue: { include: { space: { select: { name: true } }, makerspace: { select: { name: true } } } } },
  });
  if (!request || !["SENT", "ACCEPTED"].includes(request.status)) return null;
  const { issue } = request;
  const intro = payload.notice === "request" ? `${issue.makerspace.name} is asking whether you can fix this.` : `${issue.makerspace.name} has given you this repair.`;
  const lines = [intro, `${issue.space.name}: ${issue.title} (${SEVERITY_LABELS[issue.severity].toLowerCase()} priority, ${issue.reference}).`, ...(issue.description ? [issue.description] : [])];
  return { request, issue, lines };
}

export async function deliverRepairRequest(payload: RequestPayload, messageId: string): Promise<"sent" | "dropped"> {
  const context = await requestContext(payload);
  if (!context) return "dropped";
  const { issue, lines } = context;
  if (payload.channel) {
    const channel = await prisma.chatChannel.findFirst({ where: { makerspaceId: payload.makerspaceId, kind: payload.channel, enabled: true } });
    const to = payload.channel === "WHATSAPP" ? context.request.technician.whatsapp : context.request.technician.telegramChatId;
    if (!channel || !to) return "dropped";
    const config = readChannelConfig(channel);
    const direct = payload.channel === "WHATSAPP" ? { ...config, recipients: [to] } : { ...config, chatId: to };
    try {
      await sendChatMessage(payload.channel, direct as never, `${lines.join("\n")}\n${payload.url}`);
    } catch (error) {
      if (error instanceof ChatGoneError) return "dropped";
      throw error;
    }
    return "sent";
  }
  await sendBrandedEmail({
    makerspaceId: payload.makerspaceId, to: payload.to!, messageId,
    subject: payload.notice === "request" ? `Can you fix this? ${issue.space.name} at ${issue.makerspace.name}` : `Repair for you: ${issue.space.name} at ${issue.makerspace.name}`,
    heading: payload.notice === "request" ? "Repair request" : "Repair assigned to you",
    paragraphs: [...lines, payload.notice === "request" ? "Open the request to accept or decline it. The first technician to accept takes the repair." : "Open it to record what you did, add photos and enter what you ask for the work."],
    action: { label: "Open the repair", url: payload.url },
  });
  return "sent";
}

export async function deliverRepairNotice(payload: NoticePayload, messageId: string): Promise<"sent" | "dropped"> {
  const issue = await prisma.spaceIssue.findFirst({ where: { id: payload.issueId, makerspaceId: payload.makerspaceId }, include: { space: { select: { name: true } }, makerspace: { select: { name: true, slug: true } } } });
  if (!issue) return "dropped";
  const what = `${issue.space.name}: ${issue.title} (${issue.reference})`;
  const content = {
    reported: { subject: `Issue reported: ${issue.space.name}`, heading: "A space needs attention", paragraphs: [`${what}, ${SEVERITY_LABELS[issue.severity].toLowerCase()} priority.`, "Ask one or more technicians to take it from the issue page."] },
    fixed: { subject: `Repair done: ${issue.space.name}`, heading: "Ready to verify", paragraphs: [`The technician has recorded the work on ${what}.`, "Check it, then close the issue and approve the payment."] },
    taken: { subject: `Repair taken: ${issue.space.name} at ${issue.makerspace.name}`, heading: "Someone else took this repair", paragraphs: [`${what} has been taken by another technician, so your request is closed. Thank you.`] },
  }[payload.notice];
  const action = payload.notice === "taken" ? undefined : { label: "Open the issue", url: absoluteUrl(`/dashboard/${issue.makerspace.slug}/issues/${issue.id}`) };
  await sendBrandedEmail({ makerspaceId: payload.makerspaceId, to: payload.to, messageId, ...content, ...(action ? { action } : {}) });
  return "sent";
}
