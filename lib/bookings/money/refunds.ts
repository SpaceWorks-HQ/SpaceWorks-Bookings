import type { Refund, RefundKind } from "@prisma/client";
import { recordAuditEvent } from "@/lib/audit";
import { SYSTEM, type Actor, actorUserId } from "../actor";
import type { Tx } from "../db";
import { recordBookingEvent } from "../events";
import { allocateRefund, type RefundSource } from "./allocate";

/**
 * Booking refunds. Lock order: the caller holds the Booking lock; this locks the booking's paid payments (by id),
 * then creates Refund rows. Gateway refunds stay PENDING and are sent after commit (`./send.ts`); refunds of offline
 * payments, or of a gateway that is no longer connected, are PENDING with `offlineRequired` until a person hands the
 * money back and records it.
 */

/** Money already on its way back or waiting for a decision: pending refunds and failed ones nobody retried yet. */
export async function openRefundsMinor(tx: Tx, bookingId: string): Promise<number> {
  const rows = await tx.refund.findMany({
    where: { payment: { bookingId }, OR: [{ status: "PENDING" }, { status: "FAILED", retry: null }] },
    select: { amountMinor: true },
  });
  return rows.reduce((sum, row) => sum + row.amountMinor, 0);
}

/** The booking's paid payments with what is left to refund on each, locked in id order. */
export async function refundSources(tx: Tx, makerspaceId: string, bookingId: string): Promise<RefundSource[]> {
  const ids = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Payment" WHERE "bookingId" = ${bookingId} AND "makerspaceId" = ${makerspaceId} AND "status" = 'PAID' ORDER BY "id" FOR UPDATE`;
  if (ids.length === 0) return [];
  const gateway = (await tx.makerspacePaymentSettings.findUnique({ where: { makerspaceId }, select: { provider: true, secretEncrypted: true } })) ?? null;
  const payments = await tx.payment.findMany({
    where: { id: { in: ids.map((row) => row.id) } },
    select: { id: true, provider: true, gatewayPaymentId: true, amountMinor: true, capturedMinor: true, paidAt: true, refunds: { select: { amountMinor: true, status: true, retry: { select: { id: true } } } } },
  });
  return payments.map((payment) => {
    const reserved = payment.refunds
      .filter((refund) => refund.status !== "FAILED" || !refund.retry)
      .reduce((sum, refund) => sum + refund.amountMinor, 0);
    return {
      paymentId: payment.id,
      paidAt: payment.paidAt ?? new Date(0),
      refundableMinor: (payment.capturedMinor ?? payment.amountMinor) - reserved,
      gatewayUsable: payment.provider !== "OFFLINE" && Boolean(payment.gatewayPaymentId) && gateway?.provider === payment.provider && Boolean(gateway?.secretEncrypted),
    };
  });
}

/** Refund `amountMinor` of the booking over its payments (one refund group). */
export async function createBookingRefunds(
  tx: Tx,
  input: { makerspaceId: string; bookingId: string; amountMinor: number; kind: RefundKind; reason: string; actor?: Actor; now?: Date },
): Promise<Refund[]> {
  const parts = allocateRefund(input.amountMinor, await refundSources(tx, input.makerspaceId, input.bookingId));
  if (parts.length === 0) return [];
  const actor = input.actor ?? SYSTEM;
  const createdById = actorUserId(actor);
  const payments = await tx.payment.findMany({ where: { id: { in: parts.map((part) => part.paymentId) } }, select: { id: true, currency: true } });
  const groupId = parts.length > 1 ? crypto.randomUUID() : null;
  const refunds: Refund[] = [];
  for (const part of parts) {
    const currency = payments.find((payment) => payment.id === part.paymentId)!.currency;
    const refund = await tx.refund.create({
      data: {
        makerspaceId: input.makerspaceId, paymentId: part.paymentId, currency, amountMinor: part.amountMinor, kind: input.kind,
        reason: input.reason.slice(0, 300), createdById, refundGroupId: groupId, offlineRequired: part.offlineRequired,
        ...(part.offlineRequired ? { flaggedAt: input.now ?? new Date(), flagReason: "Hand this money back offline, then record how." } : {}),
      },
    });
    await recordAuditEvent({ action: "REFUND_CREATED", actorUserId: createdById, makerspaceId: input.makerspaceId, targetType: "Refund", targetId: refund.id, metadata: { amountMinor: refund.amountMinor, currency, kind: input.kind, offline: part.offlineRequired }, client: tx });
    refunds.push(refund);
  }
  await recordBookingEvent(tx, {
    makerspaceId: input.makerspaceId, bookingId: input.bookingId, kind: "refund", actor,
    data: { kind: input.kind, amountMinor: input.amountMinor, refundIds: refunds.map((refund) => refund.id), offline: parts.some((part) => part.offlineRequired) },
  });
  return refunds;
}

/** After the charge changed: refund whatever was paid beyond it and isn't already on its way back. */
export async function refundWhatIsDue(
  tx: Tx,
  input: { makerspaceId: string; bookingId: string; chargeMinor: number; netPaidMinor: number; kind: RefundKind; reason?: string; actor?: Actor; now?: Date },
): Promise<Refund[]> {
  if (input.netPaidMinor <= input.chargeMinor) return [];
  const due = input.netPaidMinor - input.chargeMinor - (await openRefundsMinor(tx, input.bookingId));
  if (due <= 0) return [];
  return createBookingRefunds(tx, { ...input, amountMinor: due, reason: input.reason ?? REFUND_REASONS[input.kind] });
}

export const REFUND_REASONS: Record<RefundKind, string> = {
  POLICY: "Refund under the cancellation policy",
  VENUE: "The makerspace cancelled",
  MANUAL: "Refund by the team",
  RESCHEDULE: "The new time costs less",
  DUPLICATE: "Paid more than was due",
  LATE_CAPTURE: "Paid after the booking ended",
  EXTERNAL: "Refunded in the payment provider's dashboard",
};
