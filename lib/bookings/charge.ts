import type { RefundKind } from "@prisma/client";
import { balanceDue, chargeFor, netPaid, refundDue } from "./obligation";
import { readPolicy } from "./pricingInputs";
import type { Actor } from "./actor";
import type { Tx } from "./db";
import { refundWhatIsDue } from "./money/refunds";

export type RecomputeOptions = {
  /** Why money paid beyond the new charge goes back (default POLICY). */
  refundKind?: RefundKind;
  refundReason?: string;
  actor?: Actor;
  now?: Date;
};

/**
 * Write `Booking.chargeMinor` from the obligation model (less any concession the team gave) after any change to
 * occurrences, prices or fees, then refund what was paid beyond it. The caller holds the Booking lock. Returns the
 * charge before and after, what that leaves due either way, and the refunds it opened (sent after commit).
 */
export async function recomputeCharge(tx: Tx, bookingId: string, options: RecomputeOptions = {}) {
  const booking = await tx.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { makerspaceId: true, chargeMinor: true, depositMinor: true, paidMinor: true, refundedMinor: true, concessionMinor: true, policySnapshot: true, cancelKind: true, occurrences: { select: { status: true, priceMinor: true, keptFeeMinor: true, noShowAt: true } } },
  });
  const money = { paidMinor: booking.paidMinor, refundedMinor: booking.refundedMinor };
  const owed = chargeFor({
    occurrences: booking.occurrences.map((row) => ({ status: row.status === "SCHEDULED" && row.noShowAt ? "NO_SHOW" : row.status, priceMinor: row.priceMinor, keptFeeMinor: row.keptFeeMinor })),
    depositMinor: booking.depositMinor,
    ...money,
    policy: readPolicy(booking.policySnapshot),
    venueCancelled: booking.cancelKind === "VENUE",
  });
  const after = Math.max(0, owed - booking.concessionMinor);
  if (after !== booking.chargeMinor) await tx.booking.update({ where: { id: bookingId }, data: { chargeMinor: after } });
  const refunds = await refundWhatIsDue(tx, {
    makerspaceId: booking.makerspaceId, bookingId, chargeMinor: after, netPaidMinor: netPaid(money),
    kind: options.refundKind ?? "POLICY", reason: options.refundReason, actor: options.actor, now: options.now,
  });
  return {
    before: booking.chargeMinor, after,
    refundDueMinor: refundDue(after, money), balanceDueMinor: balanceDue(after, money),
    refundIds: refunds.map((refund) => refund.id),
  };
}
