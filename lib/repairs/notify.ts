import { enqueueOutbox } from "@/lib/outbox";
import { absoluteUrl } from "@/lib/email/message";
import { MANAGER_ROLE } from "@/lib/permissionRoles";
import type { Tx } from "@/lib/bookings/db";

/**
 * Repair messages, queued in the change's transaction. Requests go to each technician on every channel they have
 * (email, plus WhatsApp or Telegram when the makerspace has that chat set up); a request carrying an external
 * technician's link is a capability, so its outbox row is deleted once sent. Managers hear about new and fixed
 * issues by email; technicians who were asked are told when someone else took the repair.
 */

export type RequestNotice = "request" | "assigned";
export type IssueNotice = "reported" | "fixed" | "taken";

/** Where a technician answers: their link (external) or the issue in the dashboard (staff). */
export function technicianUrl(input: { token: string | null; makerspaceSlug: string; issueId: string }) {
  return input.token ? absoluteUrl(`/repair/${input.token}`) : absoluteUrl(`/dashboard/${input.makerspaceSlug}/issues/${input.issueId}`);
}

export async function queueRequestMessages(tx: Tx, input: {
  makerspaceId: string; requestId: string; notice: RequestNotice; url: string;
  technician: { email: string | null }; channels: string[];
}) {
  if (input.channels.includes("EMAIL") && input.technician.email) {
    await enqueueOutbox(tx, "repair-request", { makerspaceId: input.makerspaceId, requestId: input.requestId, to: input.technician.email, url: input.url, notice: input.notice });
  }
  for (const channel of input.channels.filter((value) => value === "WHATSAPP" || value === "TELEGRAM")) {
    await enqueueOutbox(tx, "repair-dm", { makerspaceId: input.makerspaceId, requestId: input.requestId, channel, url: input.url, notice: input.notice });
  }
}

/** Email every bookings manager of the makerspace about an issue. */
export async function queueManagerNotice(tx: Tx, makerspaceId: string, issueId: string, notice: "reported" | "fixed") {
  const managers = await tx.teamMember.findMany({ where: { makerspaceId, role: MANAGER_ROLE, user: { email: { not: null } } }, select: { user: { select: { email: true } } }, take: 20 });
  for (const manager of managers) await enqueueOutbox(tx, "repair-notice", { makerspaceId, issueId, to: manager.user.email!, notice });
}

/** Tell technicians whose open requests were closed that the repair has been taken. */
export async function queueTakenNotices(tx: Tx, makerspaceId: string, issueId: string, technicianIds: string[]) {
  if (technicianIds.length === 0) return;
  const technicians = await tx.technician.findMany({ where: { makerspaceId, id: { in: technicianIds }, email: { not: null } }, select: { email: true } });
  for (const technician of technicians) await enqueueOutbox(tx, "repair-notice", { makerspaceId, issueId, to: technician.email!, notice: "taken" });
}
