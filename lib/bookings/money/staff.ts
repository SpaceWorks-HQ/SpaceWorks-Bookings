import "server-only";

import type { Prisma } from "@prisma/client";
import { recordAuditEvent } from "@/lib/audit";
import { MAKERSPACE_FOR_PAYMENTS } from "@/lib/payments/charges";
import { recordOfflinePayment, type OfflineMethod } from "@/lib/payments/offline";
import { processRefund } from "@/lib/payments/refunds";
import type { TaxSnapshot } from "@/lib/payments/tax";
import { requireStaff, type Actor } from "../actor";
import { recomputeCharge } from "../charge";
import { lockBooking, withTx, defaultDb, type DbOrTx } from "../db";
import { invalidInput, invalidState, notFound } from "../errors";
import { recordBookingEvent } from "../events";
import { balanceDue, netPaid } from "../obligation";
import { paymentPlan } from "./start";
import { createBookingRefunds, openRefundsMinor } from "./refunds";

/**
 * The team's money actions on a booking. Each locks the Booking first and records a BookingEvent and an audit row.
 * A refund beyond what is due is a concession: the charge drops by the same amount, so the customer never owes the
 * money the team chose to give back.
 */

type Base = { makerspaceId: string; bookingId: string; actor: Actor; now?: Date };
const reasonText = (value: string | null | undefined, what: string) => {
  const reason = value?.trim() ?? "";
  if (!reason || reason.length > 300) throw invalidInput(`Give a reason for the ${what} (up to 300 characters).`);
  return reason;
};

/** Money received at the desk (cash, UPI, bank). Maker-checker applies as for any offline payment. */
export async function recordBookingOfflinePayment(input: Base & { amountMinor?: number; method: OfflineMethod; utr?: string | null; reference?: string | null; note?: string }, db: DbOrTx = defaultDb()) {
  const staff = requireStaff(input.actor, "payments.record");
  return withTx(db, async (tx) => {
    const booking = await lockBooking(tx, input.makerspaceId, input.bookingId);
    const plan = paymentPlan(booking, { full: true });
    if (!plan) throw invalidState("Nothing is due on this booking now.");
    const amount = input.amountMinor ?? plan.amountMinor;
    if (!Number.isInteger(amount) || amount <= 0 || amount > plan.amountMinor) throw invalidInput("Enter an amount up to what is due.", { amountMinor: "At most the amount due" });
    const makerspace = await tx.makerspace.findUniqueOrThrow({ where: { id: input.makerspaceId }, select: MAKERSPACE_FOR_PAYMENTS });
    const tax = (booking.priceSnapshot as Prisma.JsonObject | null)?.tax as TaxSnapshot | undefined;
    const result = await recordOfflinePayment(tx, {
      makerspace, customer: { name: booking.contactName, email: booking.contactEmail, stateCode: tax?.supplierState ?? null }, currency: booking.currency,
      items: [{ kind: "BOOKING", description: `Booking ${booking.reference}`, amountMinor: amount }], bookingId: booking.id,
      purpose: amount < plan.amountMinor ? (netPaid(booking) > 0 ? "BALANCE" : "DEPOSIT") : plan.purpose,
      taxSnapshot: tax ? { ...tax, inclusive: true } : undefined, method: input.method, utr: input.utr, reference: input.reference, note: input.note, actorUserId: staff.userId, now: input.now,
    });
    return { paymentId: result.payment.id, settled: result.settled };
  });
}

/** Give money back with a reason, up to what is left to refund. Returns the refunds to send after commit. */
export async function refundBooking(input: Base & { amountMinor: number; reason: string }, db: DbOrTx = defaultDb()) {
  const staff = requireStaff(input.actor, "refunds.manage");
  const reason = reasonText(input.reason, "refund");
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) throw invalidInput("Enter an amount to refund.", { amountMinor: "Required" });
  return withTx(db, async (tx) => {
    const booking = await lockBooking(tx, input.makerspaceId, input.bookingId);
    const due = Math.max(0, netPaid(booking) - booking.chargeMinor - (await openRefundsMinor(tx, booking.id)));
    const concession = Math.max(0, input.amountMinor - due);
    if (concession > 0) await tx.booking.update({ where: { id: booking.id }, data: { concessionMinor: { increment: concession } } });
    const refunds = await createBookingRefunds(tx, { makerspaceId: input.makerspaceId, bookingId: booking.id, amountMinor: input.amountMinor, kind: "MANUAL", reason, actor: input.actor, now: input.now });
    await recomputeCharge(tx, booking.id, { refundKind: "MANUAL", actor: input.actor, now: input.now });
    await recordAuditEvent({ action: "BOOKING_REFUNDED", actorUserId: staff.userId, makerspaceId: input.makerspaceId, targetType: "Booking", targetId: booking.id, metadata: { amountMinor: input.amountMinor, concessionMinor: concession }, client: tx });
    return { refundIds: refunds.map((refund) => refund.id), concessionMinor: concession };
  });
}

async function failedRefund(tx: Prisma.TransactionClient, makerspaceId: string, bookingId: string, refundId: string) {
  const refund = await tx.refund.findFirst({ where: { id: refundId, makerspaceId, payment: { bookingId } }, include: { retry: { select: { id: true } } } });
  if (!refund) throw notFound("Refund");
  return refund;
}

/** Try a failed gateway refund again: a new row pointing at the failed one. */
export async function retryRefund(input: Base & { refundId: string }, db: DbOrTx = defaultDb()) {
  const staff = requireStaff(input.actor, "refunds.manage");
  return withTx(db, async (tx) => {
    await lockBooking(tx, input.makerspaceId, input.bookingId);
    const failed = await failedRefund(tx, input.makerspaceId, input.bookingId, input.refundId);
    if (failed.status !== "FAILED" || failed.retry) throw invalidState("Only a failed refund nobody retried yet can be retried.");
    const retry = await tx.refund.create({ data: { makerspaceId: input.makerspaceId, paymentId: failed.paymentId, currency: failed.currency, amountMinor: failed.amountMinor, kind: failed.kind, reason: failed.reason, createdById: staff.userId, refundGroupId: failed.refundGroupId, retryOfId: failed.id } });
    await recordBookingEvent(tx, { makerspaceId: input.makerspaceId, bookingId: input.bookingId, kind: "refund", actor: input.actor, data: { retryOf: failed.id, refundIds: [retry.id], amountMinor: retry.amountMinor } });
    await recordAuditEvent({ action: "REFUND_RETRIED", actorUserId: staff.userId, makerspaceId: input.makerspaceId, targetType: "Refund", targetId: retry.id, metadata: { retryOf: failed.id }, client: tx });
    return { refundIds: [retry.id] };
  });
}

/** The money went back outside the gateway: record how (an offline refund waiting, or in place of a failed one). */
export async function recordOfflineRefund(input: Base & { refundId: string; method: OfflineMethod; reference: string }, db: DbOrTx = defaultDb()) {
  const staff = requireStaff(input.actor, "refunds.manage");
  const reference = input.reference?.trim() ?? "";
  if (!reference || reference.length > 120) throw invalidInput("Enter the reference of the money handed back.", { reference: "Required" });
  return withTx(db, async (tx) => {
    await lockBooking(tx, input.makerspaceId, input.bookingId);
    const refund = await failedRefund(tx, input.makerspaceId, input.bookingId, input.refundId);
    const makerspace = await tx.makerspace.findUniqueOrThrow({ where: { id: input.makerspaceId }, select: MAKERSPACE_FOR_PAYMENTS });
    let target = refund.id;
    if (refund.status === "FAILED") {
      if (refund.retry) throw invalidState("This refund was already retried.");
      target = (await tx.refund.create({ data: { makerspaceId: input.makerspaceId, paymentId: refund.paymentId, currency: refund.currency, amountMinor: refund.amountMinor, kind: refund.kind, reason: refund.reason, createdById: staff.userId, refundGroupId: refund.refundGroupId, retryOfId: refund.id, offlineRequired: true } })).id;
    } else if (refund.status !== "PENDING" || (!refund.offlineRequired && refund.sentAt)) {
      throw invalidState("This refund is already with the payment provider.");
    }
    await processRefund(tx, { makerspace, refundId: target, method: input.method, reference, now: input.now });
    await recordBookingEvent(tx, { makerspaceId: input.makerspaceId, bookingId: input.bookingId, kind: "refund", actor: input.actor, data: { offline: true, refundIds: [target], method: input.method } });
    await recordAuditEvent({ action: "REFUND_RECORDED_OFFLINE", actorUserId: staff.userId, makerspaceId: input.makerspaceId, targetType: "Refund", targetId: target, metadata: { method: input.method }, client: tx });
    return { refundId: target };
  });
}

/** Stop chasing a balance: the booking shows "Written off". */
export async function writeOffBooking(input: Base & { reason: string }, db: DbOrTx = defaultDb()) {
  const staff = requireStaff(input.actor, "refunds.manage");
  const reason = reasonText(input.reason, "write-off");
  const now = input.now ?? new Date();
  return withTx(db, async (tx) => {
    const booking = await lockBooking(tx, input.makerspaceId, input.bookingId);
    if (booking.writtenOffAt) throw invalidState("This booking is already written off.");
    if (balanceDue(booking.chargeMinor, booking) <= 0) throw invalidState("Nothing is owed on this booking.");
    await tx.booking.update({ where: { id: booking.id }, data: { writtenOffAt: now, writtenOffById: staff.userId, writtenOffReason: reason } });
    await recordBookingEvent(tx, { makerspaceId: input.makerspaceId, bookingId: booking.id, kind: "written-off", actor: input.actor, data: { reason, balanceMinor: balanceDue(booking.chargeMinor, booking) } });
    await recordAuditEvent({ action: "BOOKING_WRITTEN_OFF", actorUserId: staff.userId, makerspaceId: input.makerspaceId, targetType: "Booking", targetId: booking.id, client: tx });
    return { writtenOffAt: now };
  });
}

/** Move a pay-later or balance due date (never before now). */
export async function setPaymentDueAt(input: Base & { dueAt: Date }, db: DbOrTx = defaultDb()) {
  const staff = requireStaff(input.actor, "bookings.manage");
  const now = input.now ?? new Date();
  if (!(input.dueAt instanceof Date) || Number.isNaN(input.dueAt.getTime()) || input.dueAt <= now) throw invalidInput("Choose a due date in the future.", { dueAt: "In the future" });
  return withTx(db, async (tx) => {
    const booking = await lockBooking(tx, input.makerspaceId, input.bookingId);
    if (booking.status !== "CONFIRMED" || balanceDue(booking.chargeMinor, booking) <= 0) throw invalidState("Only a confirmed booking with money due has a due date.");
    await tx.booking.update({ where: { id: booking.id }, data: { paymentDueAt: input.dueAt, paymentReminderSentAt: null, overdueNotifiedAt: null } });
    await recordBookingEvent(tx, { makerspaceId: input.makerspaceId, bookingId: booking.id, kind: "payment-due-changed", actor: input.actor, data: { from: booking.paymentDueAt, to: input.dueAt } });
    await recordAuditEvent({ action: "BOOKING_DUE_DATE_CHANGED", actorUserId: staff.userId, makerspaceId: input.makerspaceId, targetType: "Booking", targetId: booking.id, client: tx });
    return { paymentDueAt: input.dueAt };
  });
}
