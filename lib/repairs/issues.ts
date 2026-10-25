import type { IssueSeverity } from "@prisma/client";
import { requireStaff, type CustomerActor, type StaffActor } from "@/lib/bookings/actor";
import { defaultDb, withTx, type DbOrTx, type Tx } from "@/lib/bookings/db";
import { forbidden, invalidInput, invalidState, notFound } from "@/lib/bookings/errors";
import { queueChatAlerts } from "@/lib/chat/notify";
import { createBlackout, removeBlackout } from "@/lib/spaces/calendar";
import { can } from "@/lib/permissionRoles";
import { newManageToken } from "@/lib/bookings/tokens";
import { randomInt } from "node:crypto";
import { canMove, DAY_MS, LINK_DAYS } from "./rules";
import { lockIssue, recordIssueEvent, type LinkActor, type RepairActor } from "./events";
import { queueManagerNotice, queueRequestMessages, queueTakenNotices, technicianUrl } from "./notify";
import { chatProviders } from "./requests";
import { requestChannels } from "./rules";

/**
 * Space issues: report, assign, fix, verify and close, reopen, and keeping a space unbookable while it is out of
 * service (a blackout). Requests to technicians are in requests.ts, money in payouts.ts. Every change writes the
 * issue timeline in its own transaction.
 */

export type ReportInput = {
  makerspaceId: string; spaceId: string; actor: StaffActor | CustomerActor; bookingId?: string | null;
  title: string; description: string; severity: IssueSeverity;
};

export async function reportIssue(input: ReportInput, db: DbOrTx = defaultDb()) {
  if (input.actor.kind === "STAFF") requireStaff(input.actor, "issues.report");
  else if (!input.bookingId) throw forbidden();
  return withTx(db, async (tx) => {
    const space = await tx.space.findFirst({ where: { id: input.spaceId, makerspaceId: input.makerspaceId }, select: { id: true, makerspace: { select: { currency: true } } } });
    if (!space) throw notFound("Space");
    // References are random; a clash (about one in a billion) just draws again.
    let reference = newIssueReference();
    for (let attempt = 0; attempt < 5 && (await tx.spaceIssue.findUnique({ where: { makerspaceId_reference: { makerspaceId: input.makerspaceId, reference } }, select: { id: true } })); attempt += 1) reference = newIssueReference();
    const issue = await tx.spaceIssue.create({
      data: {
        makerspaceId: input.makerspaceId, spaceId: space.id, reference, title: input.title, description: input.description,
        severity: input.severity, reporterKind: input.actor.kind, reportedById: input.actor.userId, bookingId: input.bookingId ?? null, currency: space.makerspace.currency,
      },
    });
    await recordIssueEvent(tx, { makerspaceId: input.makerspaceId, issueId: issue.id, kind: "reported", actor: input.actor, data: { severity: input.severity } });
    await queueChatAlerts(tx, input.makerspaceId, "issue-reported", { issueId: issue.id });
    await queueManagerNotice(tx, input.makerspaceId, issue.id, "reported");
    return issue;
  });
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** "IS-4F2K9Q": six Crockford base32 characters, unique per makerspace. */
export function newIssueReference(): string {
  let code = "";
  for (let index = 0; index < 6; index += 1) code += CROCKFORD[randomInt(CROCKFORD.length)];
  return `IS-${code}`;
}

async function issueOrThrow(tx: Tx, makerspaceId: string, issueId: string) {
  const issue = await lockIssue(tx, makerspaceId, issueId);
  if (!issue) throw notFound("Issue");
  return issue;
}

/** A manager gives the repair to one technician directly; open requests to anyone else close. */
export async function assignTechnician(input: { makerspaceId: string; issueId: string; technicianId: string; actor: StaffActor; makerspaceSlug: string }, db: DbOrTx = defaultDb()) {
  requireStaff(input.actor, "repairs.manage");
  return withTx(db, async (tx) => {
    const issue = await issueOrThrow(tx, input.makerspaceId, input.issueId);
    if (!canMove(issue.status, "assign")) throw invalidState("This issue can't be assigned now.");
    const technician = await tx.technician.findFirst({ where: { id: input.technicianId, makerspaceId: input.makerspaceId, active: true } });
    if (!technician) throw notFound("Technician");
    if (technician.userId && !(await tx.teamMember.findFirst({ where: { makerspaceId: input.makerspaceId, userId: technician.userId, role: "TECHNICIAN" }, select: { id: true } }))) throw notFound("Technician");
    const changing = issue.technicianId !== null && issue.technicianId !== technician.id;
    if (changing && (issue.approvedMinor !== null || (await tx.repairPayout.count({ where: { issueId: issue.id } })) > 0)) throw invalidState("This repair's amount is already approved or paid, so it stays with its technician.");
    const channels = requestChannels(technician, await chatProviders(input.makerspaceId));
    if (channels.length === 0) throw invalidInput(`${technician.name} can't be reached: add an email address, or set up WhatsApp or Telegram.`);
    const now = new Date();
    const link = technician.kind === "EXTERNAL" ? newManageToken() : null;
    const request = await tx.repairRequest.upsert({
      where: { issueId_technicianId: { issueId: issue.id, technicianId: technician.id } },
      create: { makerspaceId: input.makerspaceId, issueId: issue.id, technicianId: technician.id, status: "ACCEPTED", channels: [], tokenHash: link?.hash ?? null, expiresAt: new Date(now.getTime() + LINK_DAYS * DAY_MS), sentById: input.actor.userId, answeredAt: now },
      update: { status: "ACCEPTED", tokenHash: link?.hash ?? null, expiresAt: new Date(now.getTime() + LINK_DAYS * DAY_MS), answeredAt: now },
    });
    const others = await tx.repairRequest.findMany({ where: { issueId: issue.id, id: { not: request.id }, status: { in: ["SENT", "ACCEPTED"] } }, select: { technicianId: true } });
    await tx.repairRequest.updateMany({ where: { issueId: issue.id, id: { not: request.id }, status: { in: ["SENT", "ACCEPTED"] } }, data: { status: "CLOSED", tokenHash: null } });
    await queueTakenNotices(tx, input.makerspaceId, issue.id, others.map((row) => row.technicianId));
    // A new technician starts clean: nothing the previous one recorded or asked carries over.
    await tx.spaceIssue.update({ where: { id: issue.id }, data: { status: "ASSIGNED", technicianId: technician.id, assignedAt: now, ...(changing ? { fixRemarks: "", partsUsed: "", amountAskedMinor: null, fixedAt: null } : {}) } });
    await recordIssueEvent(tx, { makerspaceId: input.makerspaceId, issueId: issue.id, kind: "assigned", actor: input.actor, technicianId: technician.id });
    await queueChatAlerts(tx, input.makerspaceId, "issue-assigned", { issueId: issue.id });
    await queueRequestMessages(tx, { makerspaceId: input.makerspaceId, requestId: request.id, notice: "assigned", url: technicianUrl({ token: link?.token ?? null, makerspaceSlug: input.makerspaceSlug, issueId: issue.id }), technician, channels });
    return { issueId: issue.id, technicianId: technician.id };
  });
}

export type FixInput = { makerspaceId: string; issueId: string; actor: StaffActor | LinkActor; remarks: string; partsUsed: string; amountAskedMinor: number | null };

/** The assigned technician (or a manager on their behalf) records the work and what it costs; the issue is FIXED. */
export async function recordFix(input: FixInput, db: DbOrTx = defaultDb()) {
  return withTx(db, async (tx) => {
    const issue = await issueOrThrow(tx, input.makerspaceId, input.issueId);
    await requireAssigned(tx, issue, input.actor);
    if (!canMove(issue.status, "fix")) throw invalidState("This issue isn't waiting for a fix.");
    if (!input.remarks.trim()) throw invalidInput("Say what you did.", { remarks: "Say what you did" });
    if (issue.approvedMinor !== null && input.amountAskedMinor !== issue.amountAskedMinor) throw invalidState("The amount was already approved; ask the makerspace to change it.");
    await tx.spaceIssue.update({ where: { id: issue.id }, data: { status: "FIXED", fixRemarks: input.remarks.trim(), partsUsed: input.partsUsed.trim(), amountAskedMinor: input.amountAskedMinor, fixedAt: new Date() } });
    await recordIssueEvent(tx, { makerspaceId: input.makerspaceId, issueId: issue.id, kind: "fixed", actor: input.actor, technicianId: issue.technicianId, data: { amountAskedMinor: input.amountAskedMinor } });
    await queueManagerNotice(tx, input.makerspaceId, issue.id, "fixed");
    return { issueId: issue.id };
  });
}

/** Only the technician holding the repair, or a bookings manager, may record work on it. */
export async function requireAssigned(tx: Tx, issue: { technicianId: string | null; makerspaceId: string }, actor: StaffActor | LinkActor) {
  if (actor.kind === "LINK") {
    if (issue.technicianId !== actor.technicianId) throw notFound("Issue");
    return;
  }
  if (can(actor.role, "repairs.manage")) return;
  requireStaff(actor, "repairs.work");
  const technician = issue.technicianId ? await tx.technician.findFirst({ where: { id: issue.technicianId, makerspaceId: issue.makerspaceId }, select: { userId: true } }) : null;
  if (technician?.userId !== actor.userId) throw notFound("Issue");
}

/** A bookings manager checks the work and closes the issue; the out-of-service block and the link end with it. */
export async function closeIssue(input: { makerspaceId: string; issueId: string; actor: StaffActor }, db: DbOrTx = defaultDb()) {
  requireStaff(input.actor, "repairs.manage");
  return withTx(db, async (tx) => {
    const issue = await issueOrThrow(tx, input.makerspaceId, input.issueId);
    if (!canMove(issue.status, "close")) throw invalidState("Only a fixed issue can be closed.");
    const now = new Date();
    if (issue.blackoutId) await dropBlackout(tx, input.makerspaceId, issue.blackoutId, input.actor);
    await tx.spaceIssue.update({ where: { id: issue.id }, data: { status: "CLOSED", closedAt: now, closedById: input.actor.userId, blackoutId: null } });
    // The technician's link stays readable (to see the payment) but takes no more work: actions need an open issue.
    await tx.repairRequest.updateMany({ where: { issueId: issue.id, status: "ACCEPTED" }, data: { expiresAt: new Date(now.getTime() + LINK_DAYS * DAY_MS) } });
    await recordIssueEvent(tx, { makerspaceId: input.makerspaceId, issueId: issue.id, kind: "closed", actor: input.actor, technicianId: issue.technicianId });
    await queueChatAlerts(tx, input.makerspaceId, "issue-resolved", { issueId: issue.id });
    return { issueId: issue.id };
  });
}

/** Not fixed after all: back to the technician (or to be asked again), with the reason on the timeline. */
export async function reopenIssue(input: { makerspaceId: string; issueId: string; actor: StaffActor; reason: string }, db: DbOrTx = defaultDb()) {
  requireStaff(input.actor, "repairs.manage");
  if (!input.reason.trim()) throw invalidInput("Say why it is reopened.", { reason: "Say why it is reopened" });
  return withTx(db, async (tx) => {
    const issue = await issueOrThrow(tx, input.makerspaceId, input.issueId);
    if (!canMove(issue.status, "reopen")) throw invalidState("Only a fixed or closed issue can be reopened.");
    await tx.spaceIssue.update({ where: { id: issue.id }, data: { status: issue.technicianId ? "ASSIGNED" : "REPORTED", fixedAt: null, closedAt: null, closedById: null } });
    await tx.repairRequest.updateMany({ where: { issueId: issue.id, technicianId: issue.technicianId ?? undefined, status: "ACCEPTED" }, data: { expiresAt: new Date(Date.now() + LINK_DAYS * DAY_MS) } });
    await recordIssueEvent(tx, { makerspaceId: input.makerspaceId, issueId: issue.id, kind: "reopened", actor: input.actor, technicianId: issue.technicianId, data: { reason: input.reason.trim().slice(0, 500) } });
    return { issueId: issue.id };
  });
}

async function dropBlackout(tx: Tx, makerspaceId: string, blackoutId: string, actor: StaffActor) {
  const exists = await tx.blackout.findFirst({ where: { id: blackoutId, makerspaceId }, select: { id: true } });
  if (exists) await removeBlackout({ makerspaceId, blackoutId, actor }, tx);
}

/** Keep the space unbookable until a date while it is out of service (the existing blackouts), or lift it. */
export async function setOutOfService(input: { makerspaceId: string; issueId: string; actor: StaffActor; today: string; until: string | null }, db: DbOrTx = defaultDb()) {
  requireStaff(input.actor, "repairs.manage");
  return withTx(db, async (tx) => {
    const issue = await issueOrThrow(tx, input.makerspaceId, input.issueId);
    if (issue.status === "CLOSED" && input.until) throw invalidState("This issue is closed.");
    if (issue.blackoutId) await dropBlackout(tx, input.makerspaceId, issue.blackoutId, input.actor);
    const blackout = input.until
      ? await createBlackout({ makerspaceId: input.makerspaceId, spaceId: issue.spaceId, actor: input.actor, blackout: { startDate: input.today, endDate: input.until, reason: `Out of service: ${issue.reference}` } }, tx)
      : null;
    await tx.spaceIssue.update({ where: { id: issue.id }, data: { blackoutId: blackout?.id ?? null } });
    await recordIssueEvent(tx, { makerspaceId: input.makerspaceId, issueId: issue.id, kind: blackout ? "out-of-service" : "back-in-service", actor: input.actor, data: blackout ? { until: input.until } : {} });
    return { blackoutId: blackout?.id ?? null };
  });
}

/** Attach an uploaded photo (at most eight per issue). */
export async function addIssuePhoto(input: { makerspaceId: string; issueId: string; actor: RepairActor; url: string; storageKey: string }, db: DbOrTx = defaultDb()) {
  return withTx(db, async (tx) => {
    const issue = await issueOrThrow(tx, input.makerspaceId, input.issueId);
    if (issue.status === "CLOSED") throw invalidState("This issue is closed.");
    if ((await tx.issuePhoto.count({ where: { issueId: issue.id } })) >= 8) throw invalidState("An issue holds at most eight photos.");
    const addedBy = input.actor.kind === "CUSTOMER" ? "CUSTOMER" : input.actor.kind === "LINK" || (input.actor.kind === "STAFF" && input.actor.role === "TECHNICIAN") ? "TECHNICIAN" : "STAFF";
    const photo = await tx.issuePhoto.create({ data: { makerspaceId: input.makerspaceId, issueId: issue.id, url: input.url, storageKey: input.storageKey, addedBy } });
    await recordIssueEvent(tx, { makerspaceId: input.makerspaceId, issueId: issue.id, kind: "photo", actor: input.actor, data: { photoId: photo.id } });
    return photo;
  });
}
