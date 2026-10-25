import { requireStaff, SYSTEM, type StaffActor } from "@/lib/bookings/actor";
import { defaultDb, withTx, type DbOrTx } from "@/lib/bookings/db";
import { invalidInput, invalidState, notFound } from "@/lib/bookings/errors";
import { hashToken, newManageToken } from "@/lib/bookings/tokens";
import { queueChatAlerts } from "@/lib/chat/notify";
import { prisma } from "@/lib/db";
import { canMove, DAY_MS, LINK_DAYS, REQUEST_ANSWER_DAYS, requestChannels } from "./rules";
import { lockIssue, recordIssueEvent, type LinkActor } from "./events";
import { queueRequestMessages, queueTakenNotices, technicianUrl } from "./notify";

/**
 * Asking technicians to take a repair. A bookings manager picks one or more from the directory; each gets the
 * request on every channel they have. The first to accept is assigned (the issue row lock decides a race), the
 * other open requests close and those technicians are told. Unanswered requests expire.
 */

/** Which chat providers the makerspace can use for direct messages. */
export async function chatProviders(makerspaceId: string) {
  const channels = await prisma.chatChannel.findMany({ where: { makerspaceId, enabled: true, kind: { in: ["WHATSAPP", "TELEGRAM"] } }, select: { kind: true } });
  return { whatsapp: channels.some((row) => row.kind === "WHATSAPP"), telegram: channels.some((row) => row.kind === "TELEGRAM") };
}

export async function sendRequests(input: { makerspaceId: string; makerspaceSlug: string; issueId: string; technicianIds: string[]; actor: StaffActor }, db: DbOrTx = defaultDb()) {
  requireStaff(input.actor, "repairs.manage");
  const ids = [...new Set(input.technicianIds)];
  if (ids.length === 0 || ids.length > 20) throw invalidInput("Choose between one and twenty technicians.");
  const available = await chatProviders(input.makerspaceId);
  return withTx(db, async (tx) => {
    const issue = await lockIssue(tx, input.makerspaceId, input.issueId);
    if (!issue) throw notFound("Issue");
    if (!canMove(issue.status, "request")) throw invalidState("This repair already has a technician.");
    const technicians = await tx.technician.findMany({ where: { makerspaceId: input.makerspaceId, id: { in: ids }, active: true } });
    const staffIds = technicians.flatMap((row) => (row.userId ? [row.userId] : []));
    const stillTechnicians = new Set((await tx.teamMember.findMany({ where: { makerspaceId: input.makerspaceId, userId: { in: staffIds }, role: "TECHNICIAN" }, select: { userId: true } })).map((row) => row.userId));
    const usable = technicians.filter((row) => row.kind === "EXTERNAL" || (row.userId && stillTechnicians.has(row.userId)));
    if (usable.length !== ids.length) throw notFound("Technician");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + REQUEST_ANSWER_DAYS * DAY_MS);
    const unreachable = usable.find((technician) => requestChannels(technician, available).length === 0);
    if (unreachable) throw invalidInput(`${unreachable.name} can't be reached: add an email address, or set up WhatsApp or Telegram.`);
    for (const technician of usable) {
      const link = technician.kind === "EXTERNAL" ? newManageToken() : null;
      const channels = requestChannels(technician, available);
      const request = await tx.repairRequest.upsert({
        where: { issueId_technicianId: { issueId: issue.id, technicianId: technician.id } },
        create: { makerspaceId: input.makerspaceId, issueId: issue.id, technicianId: technician.id, channels, tokenHash: link?.hash ?? null, expiresAt, sentById: input.actor.userId },
        update: { status: "SENT", channels, tokenHash: link?.hash ?? null, expiresAt, sentById: input.actor.userId, sentAt: now, answeredAt: null },
      });
      await recordIssueEvent(tx, { makerspaceId: input.makerspaceId, issueId: issue.id, kind: "requested", actor: input.actor, technicianId: technician.id, data: { channels } });
      await queueRequestMessages(tx, { makerspaceId: input.makerspaceId, requestId: request.id, notice: "request", url: technicianUrl({ token: link?.token ?? null, makerspaceSlug: input.makerspaceSlug, issueId: issue.id }), technician, channels });
    }
    return { sent: usable.length };
  });
}

type Answer = "ACCEPT" | "DECLINE";

/** A staff technician answers from the dashboard; `actor` must be the technician the request went to. */
export async function answerAsStaff(input: { makerspaceId: string; issueId: string; actor: StaffActor; answer: Answer }, db: DbOrTx = defaultDb()) {
  requireStaff(input.actor, "repairs.work");
  const request = await prisma.repairRequest.findFirst({ where: { makerspaceId: input.makerspaceId, issueId: input.issueId, technician: { userId: input.actor.userId } }, select: { id: true, technicianId: true } });
  if (!request) throw notFound("Issue");
  return answerRequest({ makerspaceId: input.makerspaceId, requestId: request.id, actor: input.actor, technicianId: request.technicianId, answer: input.answer }, db);
}

/** An external technician answers through their link. */
export async function answerByLink(input: { token: string; answer: Answer }, db: DbOrTx = defaultDb()) {
  const request = await findRequestByToken(input.token);
  if (!request || request.status !== "SENT") throw notFound("Request");
  const actor: LinkActor = { kind: "LINK", technicianId: request.technicianId };
  return answerRequest({ makerspaceId: request.makerspaceId, requestId: request.id, actor, technicianId: request.technicianId, answer: input.answer }, db);
}

async function answerRequest(input: { makerspaceId: string; requestId: string; technicianId: string; actor: StaffActor | LinkActor; answer: Answer }, db: DbOrTx) {
  return withTx(db, async (tx) => {
    const found = await tx.repairRequest.findFirst({ where: { id: input.requestId, makerspaceId: input.makerspaceId }, select: { issueId: true } });
    if (!found) throw notFound("Request");
    const issue = await lockIssue(tx, input.makerspaceId, found.issueId);
    if (!issue) throw notFound("Issue");
    // Read the request again under the issue lock: a concurrent answer may have changed it.
    const request = await tx.repairRequest.findUniqueOrThrow({ where: { id: input.requestId } });
    const now = new Date();
    if (request.status !== "SENT" || request.expiresAt <= now) throw invalidState("This request is no longer open.");
    if (input.answer === "DECLINE") {
      await tx.repairRequest.update({ where: { id: request.id }, data: { status: "DECLINED", answeredAt: now, tokenHash: null } });
      await recordIssueEvent(tx, { makerspaceId: input.makerspaceId, issueId: issue.id, kind: "declined", actor: input.actor, technicianId: request.technicianId });
      return { issueId: issue.id, accepted: false };
    }
    if (!canMove(issue.status, "request")) throw invalidState("Someone else has already taken this repair.");
    await tx.repairRequest.update({ where: { id: request.id }, data: { status: "ACCEPTED", answeredAt: now, expiresAt: new Date(now.getTime() + LINK_DAYS * DAY_MS) } });
    const others = await tx.repairRequest.findMany({ where: { issueId: issue.id, id: { not: request.id }, status: "SENT" }, select: { technicianId: true } });
    await tx.repairRequest.updateMany({ where: { issueId: issue.id, id: { not: request.id }, status: "SENT" }, data: { status: "CLOSED", tokenHash: null } });
    await tx.spaceIssue.update({ where: { id: issue.id }, data: { status: "ASSIGNED", technicianId: request.technicianId, assignedAt: now } });
    await recordIssueEvent(tx, { makerspaceId: input.makerspaceId, issueId: issue.id, kind: "accepted", actor: input.actor, technicianId: request.technicianId });
    await queueChatAlerts(tx, input.makerspaceId, "issue-assigned", { issueId: issue.id });
    await queueTakenNotices(tx, input.makerspaceId, issue.id, others.map((row) => row.technicianId));
    return { issueId: issue.id, accepted: true };
  });
}

/** The request behind a link token, whatever its state (callers check it). Unknown tokens are null. */
export async function findRequestByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return null;
  return prisma.repairRequest.findUnique({ where: { tokenHash: hashToken(token) } });
}

/** Requests nobody answered in time expire (scheduled job). */
export async function expireRepairRequests(now = new Date()) {
  const due = await prisma.repairRequest.findMany({ where: { status: "SENT", expiresAt: { lte: now } }, select: { id: true, makerspaceId: true, issueId: true, technicianId: true }, take: 200 });
  for (const row of due) {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.repairRequest.updateMany({ where: { id: row.id, status: "SENT" }, data: { status: "EXPIRED", tokenHash: null } });
      if (updated.count) await recordIssueEvent(tx, { makerspaceId: row.makerspaceId, issueId: row.issueId, kind: "request-expired", actor: SYSTEM, technicianId: row.technicianId });
    });
  }
  return due.length;
}

/** Who may see the issue page: everyone with issues.view, a staff technician only for issues they were asked about. */
export async function technicianCanSee(makerspaceId: string, issueId: string, userId: string) {
  return Boolean(await prisma.repairRequest.findFirst({ where: { makerspaceId, issueId, status: "ACCEPTED", technician: { userId }, issue: { technician: { userId } } }, select: { id: true } }));
}

