import type { PayoutMethod } from "@prisma/client";
import { requireStaff, type StaffActor } from "@/lib/bookings/actor";
import { defaultDb, withTx, type DbOrTx } from "@/lib/bookings/db";
import { invalidInput, invalidState, notFound } from "@/lib/bookings/errors";
import { queueChatAlerts } from "@/lib/chat/notify";
import { recordAuditEvent } from "@/lib/audit";
import { lockIssue, recordIssueEvent } from "./events";

/**
 * Paying for a repair (`repairs.pay`, bookings managers). The manager approves an amount (changing what the technician
 * asked needs a reason), then records payouts until it is paid: cash, bank transfer, UPI or other, with a reference
 * for anything but cash. Payouts are append-only and each posts its FinanceEntry by trigger in the same transaction.
 */

export async function approveRepairAmount(input: { makerspaceId: string; issueId: string; actor: StaffActor; amountMinor: number; note: string }, db: DbOrTx = defaultDb()) {
  requireStaff(input.actor, "repairs.pay");
  if (!Number.isInteger(input.amountMinor) || input.amountMinor < 0) throw invalidInput("Enter the amount to pay.", { amountMinor: "Enter the amount to pay" });
  return withTx(db, async (tx) => {
    const issue = await lockIssue(tx, input.makerspaceId, input.issueId);
    if (!issue) throw notFound("Issue");
    if (issue.status !== "FIXED" && issue.status !== "CLOSED") throw invalidState("Approve the amount once the repair is done.");
    const paid = await tx.repairPayout.aggregate({ where: { issueId: issue.id }, _sum: { amountMinor: true } });
    if (input.amountMinor < (paid._sum.amountMinor ?? 0)) throw invalidState("More than that has already been paid.");
    if (input.amountMinor !== issue.amountAskedMinor && !input.note.trim()) throw invalidInput("Say why the amount differs from what was asked.", { note: "Say why the amount differs" });
    await tx.spaceIssue.update({ where: { id: issue.id }, data: { approvedMinor: input.amountMinor, approvedById: input.actor.userId, approvalNote: input.note.trim().slice(0, 500) } });
    await recordIssueEvent(tx, { makerspaceId: input.makerspaceId, issueId: issue.id, kind: "approved", actor: input.actor, technicianId: issue.technicianId, data: { amountMinor: input.amountMinor, askedMinor: issue.amountAskedMinor } });
    await recordAuditEvent({ action: "REPAIR_AMOUNT_APPROVED", actorUserId: input.actor.userId, makerspaceId: input.makerspaceId, targetType: "SpaceIssue", targetId: issue.id, metadata: { amountMinor: input.amountMinor, currency: issue.currency }, client: tx });
    return { issueId: issue.id };
  });
}

export type PayoutInput = {
  makerspaceId: string; issueId: string; actor: StaffActor; amountMinor: number;
  method: PayoutMethod; reference: string | null; paidAt: Date; note: string;
};

export async function recordRepairPayout(input: PayoutInput, db: DbOrTx = defaultDb()) {
  requireStaff(input.actor, "repairs.pay");
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) throw invalidInput("Enter the amount paid.", { amountMinor: "Enter the amount paid" });
  const reference = input.reference?.trim() || null;
  if (input.method !== "CASH" && !reference) throw invalidInput("Add the payment reference.", { reference: "Add the reference" });
  if (input.paidAt.getTime() > Date.now() + 60_000) throw invalidInput("The payment date can't be in the future.", { paidAt: "Can't be in the future" });
  return withTx(db, async (tx) => {
    const issue = await lockIssue(tx, input.makerspaceId, input.issueId);
    if (!issue) throw notFound("Issue");
    if (issue.approvedMinor === null) throw invalidState("Approve the amount before paying.");
    const paid = (await tx.repairPayout.aggregate({ where: { issueId: issue.id }, _sum: { amountMinor: true } }))._sum.amountMinor ?? 0;
    if (paid + input.amountMinor > issue.approvedMinor) throw invalidState("That is more than is left to pay.");
    const payout = await tx.repairPayout.create({
      data: { makerspaceId: input.makerspaceId, issueId: issue.id, technicianId: issue.technicianId, amountMinor: input.amountMinor, currency: issue.currency, method: input.method, reference, note: input.note.trim().slice(0, 500), paidAt: input.paidAt, paidById: input.actor.userId },
    });
    await recordIssueEvent(tx, { makerspaceId: input.makerspaceId, issueId: issue.id, kind: "paid", actor: input.actor, technicianId: issue.technicianId, data: { payoutId: payout.id, amountMinor: payout.amountMinor } });
    await recordAuditEvent({ action: "REPAIR_PAYOUT_RECORDED", actorUserId: input.actor.userId, makerspaceId: input.makerspaceId, targetType: "RepairPayout", targetId: payout.id, metadata: { amountMinor: payout.amountMinor, currency: payout.currency, method: payout.method }, client: tx });
    await queueChatAlerts(tx, input.makerspaceId, "repair-payment", { issueId: issue.id });
    return { payoutId: payout.id, paidMinor: paid + payout.amountMinor };
  });
}
