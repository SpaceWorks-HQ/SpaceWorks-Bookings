import { balanceDue, chargeFor, refundDue } from "./obligation";
import { readPolicy } from "./pricingInputs";
import type { Tx } from "./db";

/**
 * Write `Booking.chargeMinor` from the obligation model after any change to occurrences, prices or fees. Returns the
 * charge before and after and what that leaves due either way (Phase 2 turns these into payments and refunds).
 */
export async function recomputeCharge(tx: Tx, bookingId: string) {
  const booking = await tx.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { chargeMinor: true, depositMinor: true, paidMinor: true, refundedMinor: true, policySnapshot: true, cancelKind: true, occurrences: { select: { status: true, priceMinor: true, keptFeeMinor: true, noShowAt: true } } },
  });
  const money = { paidMinor: booking.paidMinor, refundedMinor: booking.refundedMinor };
  const after = chargeFor({
    occurrences: booking.occurrences.map((row) => ({ status: row.status === "SCHEDULED" && row.noShowAt ? "NO_SHOW" : row.status, priceMinor: row.priceMinor, keptFeeMinor: row.keptFeeMinor })),
    depositMinor: booking.depositMinor,
    ...money,
    policy: readPolicy(booking.policySnapshot),
    venueCancelled: booking.cancelKind === "VENUE",
  });
  if (after !== booking.chargeMinor) await tx.booking.update({ where: { id: bookingId }, data: { chargeMinor: after } });
  return { before: booking.chargeMinor, after, refundDueMinor: refundDue(after, money), balanceDueMinor: balanceDue(after, money) };
}
