import "server-only";

import type { Prisma } from "@prisma/client";
import { recordAuditEvent } from "@/lib/audit";
import { enqueueOutbox } from "@/lib/outbox";
import { queueChatAlerts } from "@/lib/chat/notify";
import { lockPayment, type OrgForPayments } from "./charges";
import { issuePaymentDocument } from "./documents";

type Tx = Prisma.TransactionClient;

export type Capture = { gatewayPaymentId: string | null; amountMinor: number; currency: string; method: string | null };

async function documentPrefix(tx: Tx, organisationId: string) {
  const settings = await tx.orgTaxSettings.findUnique({ where: { organisationId }, select: { receiptPrefix: true } });
  return settings?.receiptPrefix ?? "";
}

/**
 * Money arrived for a payment: mark it PAID and issue the document, all in the caller's transaction.
 * Business-rule surprises (late, mismatched, inactive makerspace) never refuse the money: the payment is
 * still PAID and receipted, and flagged for the team. A mismatched amount holds the document until someone
 * decides. Idempotent: a PAID payment is returned unchanged. What the money pays for (a booking) is
 * confirmed by the caller in the same transaction (Phase 2).
 */
export async function settlePayment(tx: Tx, args: { org: OrgForPayments; paymentId: string; capture?: Capture; confirmedById?: string | null; now?: Date }) {
  const now = args.now ?? new Date();
  const payment = await lockPayment(tx, args.org.id, args.paymentId);
  if (payment.status === "PAID" || payment.status === "WAIVED") return { payment, flagged: payment.flagReason, alreadySettled: true };

  const flags: string[] = [];
  const capture = args.capture;
  const mismatch = Boolean(capture && (capture.amountMinor !== payment.amountMinor || capture.currency.toUpperCase() !== payment.currency));
  if (mismatch) flags.push("The amount received differs from the amount due.");
  if (payment.status === "CANCELLED" || payment.status === "FAILED") flags.push("Paid after this attempt was closed.");
  if (args.org.status !== "ACTIVE") flags.push("Paid while the organisation was not active.");

  const updated = await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: "PAID",
      paidAt: now,
      gatewayPaymentId: capture?.gatewayPaymentId ?? payment.gatewayPaymentId,
      method: capture?.method ?? payment.method,
      capturedMinor: mismatch ? capture!.amountMinor : null,
      confirmedById: args.confirmedById ?? null,
      flaggedAt: flags.length ? now : null,
      flagReason: flags.length ? flags.join(" ") : null,
      documentHeld: mismatch,
    },
  });
  if (!mismatch) await issuePaymentDocument(tx, args.org, payment.id, await documentPrefix(tx, args.org.id), now);
  await enqueueOutbox(tx, "payment-notice", { organisationId: args.org.id, paymentId: payment.id, notice: "paid" });
  await queueChatAlerts(tx, args.org.id, "payment", { paymentId: payment.id });
  await recordAuditEvent({ action: "PAYMENT_PAID", actorUserId: args.confirmedById ?? null, organisationId: args.org.id, targetType: "Payment", targetId: payment.id, metadata: { provider: payment.provider, flagged: flags.length > 0 }, client: tx });
  return { payment: updated, flagged: updated.flagReason, alreadySettled: false };
}

/** After reviewing a mismatched capture, issue the held document on the amount actually received. */
export async function releaseHeldDocument(tx: Tx, args: { org: OrgForPayments; paymentId: string; actorUserId: string; now?: Date }) {
  const payment = await lockPayment(tx, args.org.id, args.paymentId);
  if (payment.status !== "PAID" || !payment.documentHeld) throw new Error("This payment has no held document.");
  const document = await issuePaymentDocument(tx, args.org, payment.id, await documentPrefix(tx, args.org.id), args.now, payment.capturedMinor ?? payment.amountMinor);
  await tx.payment.update({ where: { id: payment.id }, data: { documentHeld: false } });
  await recordAuditEvent({ action: "PAYMENT_DOCUMENT_RELEASED", actorUserId: args.actorUserId, organisationId: args.org.id, targetType: "Payment", targetId: payment.id, client: tx });
  return document;
}

/** Clear a payment's review flag once a manager has dealt with it. */
export async function clearPaymentFlag(tx: Tx, args: { org: OrgForPayments; paymentId: string; actorUserId: string }) {
  const payment = await lockPayment(tx, args.org.id, args.paymentId);
  if (!payment.flaggedAt || payment.documentHeld) throw new Error("Nothing to clear on this payment.");
  await tx.payment.update({ where: { id: payment.id }, data: { flaggedAt: null } });
  await recordAuditEvent({ action: "PAYMENT_FLAG_CLEARED", actorUserId: args.actorUserId, organisationId: args.org.id, targetType: "Payment", targetId: payment.id, metadata: { reason: payment.flagReason }, client: tx });
}

/** A gateway attempt failed or expired. Only an open attempt moves; anything settled stays as it is. */
export async function failPayment(tx: Tx, args: { org: OrgForPayments; paymentId: string; reason: string }) {
  const payment = await lockPayment(tx, args.org.id, args.paymentId);
  if (payment.status !== "PENDING") return payment;
  return tx.payment.update({ where: { id: payment.id }, data: { status: "FAILED", note: args.reason.slice(0, 300) } });
}
