import type { BookingStatus, OccurrenceStatus } from "@prisma/client";
import { divRoundHalfUp } from "@/lib/pricing/blocks";

/**
 * The obligation model: one formula for what a customer owes in every scenario. Pure; the booking services write
 * its result to `Booking.chargeMinor` on every change, and Phase 2 settles money against it.
 *
 * - A live occurrence (scheduled, checked in, completed) owes its price.
 * - Cancelling an occurrence (or rescheduling it to a cheaper slot, for the difference) keeps a fee: (1 − tier refund) × its price, the tier chosen by hours from its
 *   `policyAnchorAt` (the earliest start it ever had) to the moment of cancelling. A venue cancel keeps nothing.
 * - A no-show owes its price under `noShowCharge` FULL; under NONE only money already paid is kept.
 * - A kept fee on an unpaid booking is owed only with `chargeLateCancelWhenUnpaid`; otherwise it only keeps money
 *   already paid (the rest of the balance is void).
 * - A non-refundable deposit is a floor: charge ≥ min(deposit, net paid), except after a venue cancel.
 * - refundDue = max(0, net paid − charge); balanceDue = max(0, charge − net paid).
 */

export type RefundTierInput = { minHoursBefore: number; refundBps: number };
export type ObligationPolicy = { depositRefundable: boolean; chargeLateCancelWhenUnpaid: boolean; noShowCharge: "FULL" | "NONE" };
export type ObligationOccurrence = { status: OccurrenceStatus; priceMinor: number; keptFeeMinor: number };
export type ObligationInput = {
  occurrences: ObligationOccurrence[];
  depositMinor: number;
  paidMinor: number;
  refundedMinor: number;
  policy: ObligationPolicy;
  /** The venue cancelled the booking: everything paid comes back, deposit included. */
  venueCancelled?: boolean;
};

const HOUR = 3_600_000;

/** The refund share (bps) for cancelling `hoursBefore` the anchor. No tiers = full refund. */
export function tierRefundBps(tiers: RefundTierInput[], hoursBefore: number): number {
  if (tiers.length === 0) return 10_000;
  const match = [...tiers].sort((a, b) => b.minHoursBefore - a.minHoursBefore).find((tier) => tier.minHoursBefore <= hoursBefore);
  return match ? match.refundBps : 0;
}

/** Hours from `now` until the anchor (negative once it has passed). */
export function hoursUntil(anchor: Date, now: Date): number {
  return (anchor.getTime() - now.getTime()) / HOUR;
}

/** The fee kept when cancelling (or shortening) `amountMinor` worth of an occurrence. */
export function keptFee(amountMinor: number, tiers: RefundTierInput[], anchor: Date, now: Date): number {
  if (amountMinor <= 0) return 0;
  const refundBps = tierRefundBps(tiers, hoursUntil(anchor, now));
  return amountMinor - divRoundHalfUp(BigInt(amountMinor) * BigInt(refundBps), 10_000);
}

export function netPaid(input: { paidMinor: number; refundedMinor: number }): number {
  return input.paidMinor - input.refundedMinor;
}

/** What the customer owes now. */
export function chargeFor(input: ObligationInput): number {
  let hard = 0;
  let soft = 0;
  for (const occurrence of input.occurrences) {
    if (occurrence.status === "SCHEDULED" || occurrence.status === "CHECKED_IN" || occurrence.status === "COMPLETED") hard += occurrence.priceMinor;
    else if (occurrence.status === "NO_SHOW") {
      if (input.policy.noShowCharge === "FULL") hard += occurrence.priceMinor;
      else soft += occurrence.priceMinor;
    }
    // Fees kept from cancelling or shortening (reschedule to a cheaper slot) a row.
    if (occurrence.keptFeeMinor > 0 && !input.venueCancelled) {
      if (input.policy.chargeLateCancelWhenUnpaid) hard += occurrence.keptFeeMinor;
      else soft += occurrence.keptFeeMinor;
    }
  }
  const paid = Math.max(0, netPaid(input));
  let charge = hard + Math.min(soft, Math.max(0, paid - hard));
  if (!input.policy.depositRefundable && !input.venueCancelled) charge = Math.max(charge, Math.min(input.depositMinor, paid));
  return charge;
}

export function refundDue(chargeMinor: number, money: { paidMinor: number; refundedMinor: number }): number {
  return Math.max(0, netPaid(money) - chargeMinor);
}

export function balanceDue(chargeMinor: number, money: { paidMinor: number; refundedMinor: number }): number {
  return Math.max(0, chargeMinor - netPaid(money));
}

export type PaymentState = "NOT_REQUIRED" | "UNPAID" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "VOID" | "WRITTEN_OFF" | "REFUND_DUE" | "REFUNDED";

export type PaymentStateInput = {
  status: BookingStatus;
  totalMinor: number;
  chargeMinor: number;
  paidMinor: number;
  refundedMinor: number;
  paymentDueAt: Date | null;
  writtenOffAt: Date | null;
};

/** The payment state, derived (never stored): OVERDUE depends on `now`. */
export function paymentState(booking: PaymentStateInput, now: Date): PaymentState {
  if (booking.writtenOffAt) return "WRITTEN_OFF";
  const paid = netPaid(booking);
  if (paid > booking.chargeMinor) return "REFUND_DUE";
  if (booking.chargeMinor === 0) {
    if (booking.refundedMinor > 0) return "REFUNDED";
    if (booking.totalMinor === 0) return "NOT_REQUIRED";
    return "VOID";
  }
  if (paid >= booking.chargeMinor) return "PAID";
  if (booking.paymentDueAt && now > booking.paymentDueAt) return "OVERDUE";
  return paid > 0 ? "PARTIALLY_PAID" : "UNPAID";
}

export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
  NOT_REQUIRED: "No payment needed",
  UNPAID: "Payment pending",
  PARTIALLY_PAID: "Partly paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  VOID: "Nothing to pay",
  WRITTEN_OFF: "Written off",
  REFUND_DUE: "Refund due",
  REFUNDED: "Refunded",
};
