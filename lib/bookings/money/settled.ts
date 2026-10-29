import type { Payment, RefundKind } from "@prisma/client";
import { SYSTEM } from "../actor";
import { confirmPaidBooking } from "../approval";
import { recomputeCharge } from "../charge";
import { lockSpaces, type Tx } from "../db";
import { recordBookingEvent } from "../events";
import { runBookingConfirmed } from "../hooks";
import { enqueueBookingNotice } from "../notify";
import { reviveExpiredBooking } from "../status";
import { hasRequiredUpfrontPayment } from "./confirmation";

/**
 * A payment for a booking just became PAID, in the transaction of `settlePayment`, which locked the Booking before
 * the Payment. Money is never refused; what it means for the booking depends on where the booking is now:
 * - HELD awaiting payment: confirmed (a hold that ran out but wasn't swept yet still holds its times).
 * - EXPIRED (late capture): confirmed again when every time is still free, else the payment is refunded.
 * - CANCELLED or DECLINED: whatever isn't owed is refunded (LATE_CAPTURE).
 * - anything else: money beyond the charge is refunded (DUPLICATE).
 * The payment is flagged whenever any of that was a surprise. Returns the refunds opened (sent after commit).
 */
export async function onBookingPaymentSettled(tx: Tx, payment: Pick<Payment, "id" | "makerspaceId" | "bookingId" | "amountMinor" | "capturedMinor" | "purpose" | "flagReason">, now: Date, options: { recordPaymentEvent?: boolean } = {}) {
  if (!payment.bookingId) return [];
  const booking = await tx.booking.findUniqueOrThrow({ where: { id: payment.bookingId } });
  const base = { makerspaceId: booking.makerspaceId, bookingId: booking.id };
  let kind: RefundKind = "DUPLICATE";
  let flag: string | null = null;
  const enough = ["HELD", "EXPIRED"].includes(booking.status) && await hasRequiredUpfrontPayment(tx, booking);
  if (booking.status === "HELD" && booking.awaitingPayment) {
    if (enough) {
      if (booking.holdExpiresAt && booking.holdExpiresAt <= now) flag = "Paid after the hold ran out; the times were still held, so the booking was confirmed.";
      await confirmPaidBooking(tx, { ...base, now });
    } else flag = "The required upfront payment has not been received and reviewed; the booking remains held.";
  } else if (booking.status === "EXPIRED" && enough && (await timesStillFree(tx, booking.id, booking.spaceId, booking.expiredAt))) {
    await reviveExpiredBooking(tx, booking, now);
    await recordBookingEvent(tx, { ...base, kind: "revived", actor: SYSTEM, data: { paymentId: payment.id } });
    await enqueueBookingNotice(tx, { ...base, notice: "confirmed" });
    await runBookingConfirmed(tx, booking.id);
    flag = "Paid after the hold ran out; the times were still free, so the booking was confirmed again.";
  } else if (["EXPIRED", "CANCELLED", "DECLINED"].includes(booking.status)) {
    kind = "LATE_CAPTURE";
    flag = booking.status === "EXPIRED" ? "Paid after the hold ran out, but the upfront payment was insufficient or the time was unavailable; refunded." : "Paid after the booking ended; refunded.";
  } else if (booking.status === "REQUESTED") {
    flag = "Paid before the request was approved.";
  }
  if (options.recordPaymentEvent !== false) await recordBookingEvent(tx, { ...base, kind: "payment", actor: SYSTEM, data: { paymentId: payment.id, amountMinor: payment.capturedMinor ?? payment.amountMinor, purpose: payment.purpose } });
  const charge = await recomputeCharge(tx, booking.id, { refundKind: kind, now });
  if (charge.refundIds.length && !flag) flag = "Paid more than was due; the extra is being refunded.";
  if (flag) {
    await tx.payment.update({ where: { id: payment.id }, data: { flaggedAt: now, flagReason: [payment.flagReason, flag].filter(Boolean).join(" ").slice(0, 500) } });
  }
  return charge.refundIds;
}

/** Every time the expiry cancelled is free again on its unit (no other blocking row overlaps it). */
async function timesStillFree(tx: Tx, bookingId: string, spaceId: string, expiredAt: Date | null): Promise<boolean> {
  if (!expiredAt) return false;
  await lockSpaces(tx, [spaceId]);
  const rows = await tx.bookingOccurrence.findMany({ where: { bookingId, status: "CANCELLED", cancelledAt: expiredAt }, select: { unit: true, blockStart: true, blockEnd: true } });
  if (rows.length === 0) return false;
  for (const row of rows) {
    const clash = await tx.bookingOccurrence.findFirst({
      where: { spaceId, unit: row.unit, blocking: true, bookingId: { not: bookingId }, blockStart: { lt: row.blockEnd }, blockEnd: { gt: row.blockStart } },
      select: { id: true },
    });
    if (clash) return false;
  }
  return true;
}
