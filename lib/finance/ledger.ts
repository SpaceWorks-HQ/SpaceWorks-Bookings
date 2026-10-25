import { randomUUID } from "node:crypto";
import type { FinanceCategory, FinanceDirection, FinanceMethod } from "@prisma/client";
import { requireStaff, type StaffActor } from "@/lib/bookings/actor";
import { defaultDb, withTx, type DbOrTx } from "@/lib/bookings/db";
import { invalidInput, invalidState, notFound } from "@/lib/bookings/errors";
import { recordAuditEvent } from "@/lib/audit";

/**
 * The finance ledger (`FinanceEntry`, append-only by trigger). Payments, refunds and repair payouts post themselves by
 * trigger in their own transaction (migration 0006). This file adds what a bookings manager types in, other income
 * and expenses such as rent or utilities, and reversals, the only way to correct an entry.
 */

/** Categories a person may post by hand; the rest come only from their source. */
export const MANUAL_CATEGORIES: Record<FinanceDirection, FinanceCategory[]> = {
  IN: ["OTHER_INCOME"],
  OUT: ["RENT", "UTILITIES", "SUPPLIES", "STAFF_COSTS", "OTHER_EXPENSE"],
};
export const MANUAL_METHODS: FinanceMethod[] = ["CASH", "BANK_TRANSFER", "UPI", "OTHER"];

export type ManualEntryInput = {
  makerspaceId: string; actor: StaffActor; direction: FinanceDirection; category: FinanceCategory; amountMinor: number;
  method: FinanceMethod; reference: string | null; occurredAt: Date; note: string;
};

export async function postManualEntry(input: ManualEntryInput, db: DbOrTx = defaultDb()) {
  requireStaff(input.actor, "finance.manage");
  if (!MANUAL_CATEGORIES[input.direction].includes(input.category)) throw invalidInput("Choose a category for this kind of entry.", { category: "Choose a category" });
  if (!MANUAL_METHODS.includes(input.method)) throw invalidInput("Choose how the money moved.", { method: "Choose a method" });
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) throw invalidInput("Enter the amount.", { amountMinor: "Enter the amount" });
  if (!input.note.trim()) throw invalidInput("Say what it was for.", { note: "Say what it was for" });
  if (input.occurredAt.getTime() > Date.now() + 60_000) throw invalidInput("The date can't be in the future.", { occurredAt: "Can't be in the future" });
  return withTx(db, async (tx) => {
    // One currency per makerspace ledger: manual entries are always in the makerspace's own.
    const { currency } = await tx.makerspace.findUniqueOrThrow({ where: { id: input.makerspaceId }, select: { currency: true } });
    const id = randomUUID();
    const entry = await tx.financeEntry.create({
      data: {
        id, makerspaceId: input.makerspaceId, direction: input.direction, category: input.category, amountMinor: input.amountMinor, currency,
        method: input.method, reference: input.reference?.trim() || null, occurredAt: input.occurredAt, sourceType: "MANUAL", sourceId: id,
        actorUserId: input.actor.userId, note: input.note.trim().slice(0, 500),
      },
    });
    await recordAuditEvent({ action: "FINANCE_ENTRY_POSTED", actorUserId: input.actor.userId, makerspaceId: input.makerspaceId, targetType: "FinanceEntry", targetId: id, metadata: { direction: input.direction, category: input.category, amountMinor: input.amountMinor, currency }, client: tx });
    return entry;
  });
}

/** Cancel an entry out with an opposite one (same category and amount), once, with a reason. */
export async function reverseEntry(input: { makerspaceId: string; actor: StaffActor; entryId: string; reason: string }, db: DbOrTx = defaultDb()) {
  requireStaff(input.actor, "finance.manage");
  if (!input.reason.trim()) throw invalidInput("Say why it is reversed.", { reason: "Say why it is reversed" });
  return withTx(db, async (tx) => {
    const original = await tx.financeEntry.findFirst({ where: { id: input.entryId, makerspaceId: input.makerspaceId } });
    if (!original) throw notFound("Entry");
    if (original.sourceType !== "MANUAL") throw invalidState("Only hand-posted entries are reversed here; payments, refunds and payouts are corrected at their source.");
    if (await tx.financeEntry.findUnique({ where: { reversesId: original.id }, select: { id: true } })) throw invalidState("This entry was already reversed.");
    const id = randomUUID();
    const entry = await tx.financeEntry.create({
      data: {
        id, makerspaceId: input.makerspaceId, direction: original.direction === "IN" ? "OUT" : "IN", category: original.category, amountMinor: original.amountMinor,
        currency: original.currency, method: original.method, reference: original.reference, occurredAt: new Date(), sourceType: "REVERSAL", sourceId: original.id,
        actorUserId: input.actor.userId, note: input.reason.trim().slice(0, 500), reversesId: original.id,
      },
    });
    await recordAuditEvent({ action: "FINANCE_ENTRY_REVERSED", actorUserId: input.actor.userId, makerspaceId: input.makerspaceId, targetType: "FinanceEntry", targetId: original.id, metadata: { reversalId: id }, client: tx });
    return entry;
  });
}
