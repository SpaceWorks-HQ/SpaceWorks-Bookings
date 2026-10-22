import "server-only";

import type { Prisma } from "@prisma/client";
import { recordAuditEvent } from "@/lib/audit";
import { enqueueOutbox } from "@/lib/outbox";
import { queueChatAlerts } from "@/lib/chat/notify";
import { createPayment, lockPayment, PaymentError, type OrgForPayments, type PaymentCustomer } from "./charges";
import { settlePayment } from "./settle";
import type { ChargeItem } from "./tax";
import type { OfflineMethod } from "./offline-methods";

export { OFFLINE_METHODS, OFFLINE_METHOD_LABELS, type OfflineMethod } from "./offline-methods";

type Tx = Prisma.TransactionClient;

/**
 * A manager records money received outside the gateway. With maker-checker on, it waits for a different
 * member of the team to confirm; otherwise it is paid and receipted straight away.
 */
export async function recordOfflinePayment(tx: Tx, args: { org: OrgForPayments; customer: PaymentCustomer; currency: string; items: ChargeItem[]; bookingId?: string | null; method: OfflineMethod; utr?: string | null; reference?: string | null; note?: string; actorUserId: string; now?: Date }) {
  const now = args.now ?? new Date();
  const payment = await createPayment(tx, {
    org: args.org,
    customer: args.customer,
    currency: args.currency,
    items: args.items,
    bookingId: args.bookingId ?? null,
    provider: "OFFLINE",
    status: "AWAITING_CONFIRMATION",
    method: args.method,
    utr: args.utr ?? null,
    reference: args.reference ?? null,
    note: args.note ?? "",
    recordedById: args.actorUserId,
  });
  await recordAuditEvent({ action: "PAYMENT_RECORDED", actorUserId: args.actorUserId, organisationId: args.org.id, targetType: "Payment", targetId: payment.id, metadata: { method: args.method }, client: tx });
  if (args.org.offlineConfirmationRequired) {
    await queueChatAlerts(tx, args.org.id, "payment-to-confirm", { paymentId: payment.id });
    return { payment, settled: false };
  }
  const { payment: settled } = await settlePayment(tx, { org: args.org, paymentId: payment.id, confirmedById: args.actorUserId, now });
  return { payment: settled, settled: true };
}

/** Confirm an offline payment waiting in the queue. The confirmer may not be the person who recorded it. */
export async function confirmOfflinePayment(tx: Tx, args: { org: OrgForPayments; paymentId: string; actorUserId: string; now?: Date }) {
  const payment = await lockPayment(tx, args.org.id, args.paymentId);
  if (payment.provider !== "OFFLINE" || payment.status !== "AWAITING_CONFIRMATION") throw new PaymentError("This payment isn't waiting for confirmation.");
  if (args.org.offlineConfirmationRequired && payment.recordedById === args.actorUserId) throw new PaymentError("Someone else on the team needs to confirm a payment you recorded.");
  const result = await settlePayment(tx, { org: args.org, paymentId: payment.id, confirmedById: args.actorUserId, now: args.now });
  await recordAuditEvent({ action: "PAYMENT_CONFIRMED", actorUserId: args.actorUserId, organisationId: args.org.id, targetType: "Payment", targetId: payment.id, client: tx });
  return result.payment;
}

/** Turn down an offline payment waiting for confirmation. */
export async function rejectOfflinePayment(tx: Tx, args: { org: OrgForPayments; paymentId: string; actorUserId: string; reason: string }) {
  const payment = await lockPayment(tx, args.org.id, args.paymentId);
  if (payment.provider !== "OFFLINE" || payment.status !== "AWAITING_CONFIRMATION") throw new PaymentError("This payment isn't waiting for confirmation.");
  const updated = await tx.payment.update({ where: { id: payment.id }, data: { status: "FAILED", note: args.reason.slice(0, 300) } });
  await enqueueOutbox(tx, "payment-notice", { organisationId: args.org.id, paymentId: payment.id, notice: "rejected" });
  await recordAuditEvent({ action: "PAYMENT_REJECTED", actorUserId: args.actorUserId, organisationId: args.org.id, targetType: "Payment", targetId: payment.id, client: tx });
  return updated;
}

/** Cancel an open payment (never a settled one). */
export async function cancelPayment(tx: Tx, args: { org: OrgForPayments; paymentId: string; actorUserId: string | null; reason?: string }) {
  const payment = await lockPayment(tx, args.org.id, args.paymentId);
  if (payment.status !== "PENDING" && payment.status !== "AWAITING_CONFIRMATION") throw new PaymentError("Only an open payment can be cancelled.");
  const updated = await tx.payment.update({ where: { id: payment.id }, data: { status: "CANCELLED", note: (args.reason ?? "Cancelled.").slice(0, 300) } });
  await recordAuditEvent({ action: "PAYMENT_CANCELLED", actorUserId: args.actorUserId, organisationId: args.org.id, targetType: "Payment", targetId: payment.id, client: tx });
  return updated;
}
