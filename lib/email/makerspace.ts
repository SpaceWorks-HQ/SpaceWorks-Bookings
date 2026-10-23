import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { MAKERSPACE_NOTICES, type MakerspaceNotice } from "@/lib/makerspaceLifecycle";
import { absoluteUrl, sendBrandedEmail } from "./message";

type NoticePayload = { to: string; makerspaceId: string; notice: MakerspaceNotice; reason?: string };
type AdminPayload = { to: string; makerspaceId: string; resubmitted?: boolean };
type InvitePayload = { to: string; makerspaceId: string; token: string; expiresAt: string };

function record(value: Prisma.JsonValue): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;

export function asNoticePayload(value: Prisma.JsonValue): NoticePayload | null {
  const p = record(value);
  if (!p || !isText(p.to, 320) || !isText(p.makerspaceId, 64) || !MAKERSPACE_NOTICES.includes(p.notice as MakerspaceNotice)) return null;
  if (p.reason !== undefined && !isText(p.reason, 2000)) return null;
  return p as NoticePayload;
}

export function asAdminPayload(value: Prisma.JsonValue): AdminPayload | null {
  const p = record(value);
  if (!p || !isText(p.to, 320) || !isText(p.makerspaceId, 64)) return null;
  return p as AdminPayload;
}

export function asInvitePayload(value: Prisma.JsonValue): InvitePayload | null {
  const p = record(value);
  if (!p || !isText(p.to, 320) || !isText(p.makerspaceId, 64) || !isText(p.token, 256) || !isText(p.expiresAt, 64)) return null;
  return p as InvitePayload;
}

async function findMakerspace(id: string) {
  return prisma.makerspace.findUnique({ where: { id }, select: { name: true, slug: true } });
}

/** Tell an owner about their application or makerspace. Returns "dropped" if the makerspace is gone. */
export async function deliverMakerspaceNotice(payload: NoticePayload, messageId: string): Promise<"sent" | "dropped"> {
  const makerspace = await findMakerspace(payload.makerspaceId);
  if (!makerspace) return "dropped";
  const application = absoluteUrl(`/dashboard/${makerspace.slug}/application`);
  const dashboard = absoluteUrl(`/dashboard/${makerspace.slug}`);
  const reason = payload.reason ? [`Note from the platform team: ${payload.reason}`] : [];
  const content = {
    received: {
      subject: `We received the application for ${makerspace.name}`,
      heading: "Application received",
      paragraphs: [`Thanks for applying to run ${makerspace.name} on Space Works Bookings. A platform admin will review it and we will email you when there is a decision.`],
      action: { label: "View your application", url: application },
    },
    approved: {
      subject: `${makerspace.name} is approved`,
      heading: "You're approved",
      paragraphs: [`${makerspace.name} can now take bookings here. Start by adding your logo, setting up payments and inviting your team.`],
      action: { label: "Open your dashboard", url: dashboard },
    },
    "changes-requested": {
      subject: `Changes needed for ${makerspace.name}`,
      heading: "A few changes needed",
      paragraphs: [`The platform team needs a few changes before ${makerspace.name} can be approved.`, ...reason, "Update your application and send it again."],
      action: { label: "Update your application", url: application },
    },
    rejected: {
      subject: `Your application for ${makerspace.name}`,
      heading: "Application not approved",
      paragraphs: [`The application for ${makerspace.name} was not approved.`, ...reason, "If you think this is a mistake, reply to the platform operator."],
      action: { label: "View your application", url: application },
    },
    suspended: {
      subject: `${makerspace.name} is suspended`,
      heading: "Makerspace suspended",
      paragraphs: [`${makerspace.name} has been suspended. New bookings are paused and most changes wait. Money already received is still receipted.`, ...reason],
      action: { label: "View status", url: application },
    },
    reactivated: {
      subject: `${makerspace.name} is active again`,
      heading: "Makerspace reactivated",
      paragraphs: [`${makerspace.name} is active again. Everything works as before.`],
      action: { label: "Open your dashboard", url: dashboard },
    },
    created: {
      subject: `${makerspace.name} is ready`,
      heading: "Your makerspace is ready",
      paragraphs: [`A platform admin set up ${makerspace.name} for you on Space Works Bookings.`],
      action: { label: "Open your dashboard", url: dashboard },
    },
  }[payload.notice];
  await sendBrandedEmail({ to: payload.to, messageId, ...content });
  return "sent";
}

/** Tell a platform admin that an application is waiting. */
export async function deliverAdminApplicationAlert(payload: AdminPayload, messageId: string): Promise<"sent" | "dropped"> {
  const makerspace = await findMakerspace(payload.makerspaceId);
  if (!makerspace) return "dropped";
  await sendBrandedEmail({
    to: payload.to,
    messageId,
    subject: `${payload.resubmitted ? "Updated application" : "New makerspace application"}: ${makerspace.name}`,
    heading: payload.resubmitted ? "An application was updated" : "A new makerspace applied",
    paragraphs: [`${makerspace.name} ${payload.resubmitted ? "updated its application after your requested changes" : "wants to take bookings on this platform"}. Review it to approve, ask for changes or decline.`],
    action: { label: "Review the application", url: absoluteUrl(`/super-admin/makerspaces/${payload.makerspaceId}`) },
  });
  return "sent";
}

/** Invite the person a platform admin named as owner of a new makerspace. */
export async function deliverOwnerInvite(payload: InvitePayload, messageId: string): Promise<"sent" | "dropped"> {
  const makerspace = await findMakerspace(payload.makerspaceId);
  if (!makerspace || new Date(payload.expiresAt) <= new Date()) return "dropped";
  await sendBrandedEmail({
    to: payload.to,
    messageId,
    subject: `You're invited to run ${makerspace.name}`,
    heading: `Run ${makerspace.name} on Space Works Bookings`,
    paragraphs: [`A platform admin set up ${makerspace.name} and named you as its owner. Accept the invite with this email address to open its dashboard and start setting up its spaces.`],
    action: { label: "Accept the invite", url: absoluteUrl(`/join/makerspace/${payload.token}`) },
    footnote: `This link works once and expires on ${new Date(payload.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}. Sign in or create an account with ${payload.to} to accept it.`,
  });
  return "sent";
}
