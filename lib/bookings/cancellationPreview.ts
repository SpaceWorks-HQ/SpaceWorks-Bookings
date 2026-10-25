import type { Booking, BookingOccurrence } from "@prisma/client";
import type { CancelScope } from "./cancel";
import { chargeFor, keptFee, refundDue, balanceDue } from "./obligation";
import { readPolicy } from "./pricingInputs";

/** Mirrors the obligation model without writing; amounts include existing fees and the deposit floor. */
export function cancellationPreview(booking: Pick<Booking, "status" | "policySnapshot" | "depositMinor" | "paidMinor" | "refundedMinor">,
  rows: BookingOccurrence[], scope: CancelScope, now: Date, cutoffHours: number) {
  const anchor = scope.type === "ALL" ? null : rows.find((row) => row.id === scope.occurrenceId);
  const targets = rows.filter((row) => row.status === "SCHEDULED" && (scope.type === "ALL" || (scope.type === "OCCURRENCE" ? row.slotIndex === anchor?.slotIndex : anchor && row.startsAt >= anchor.startsAt)));
  const policy = readPolicy(booking.policySnapshot);
  const targetIds = new Set(targets.map((row) => row.id));
  const charge = chargeFor({ ...booking, policy, occurrences: rows.map((row) => targetIds.has(row.id)
    ? { ...row, status: "CANCELLED", keptFeeMinor: row.keptFeeMinor + (booking.status === "CONFIRMED" ? keptFee(row.priceMinor, policy.refundTiers, row.policyAnchorAt, now) : 0) }
    : { ...row, status: row.status === "SCHEDULED" && row.noShowAt ? "NO_SHOW" : row.status }) });
  const remainingPrice = rows.filter((row) => !targetIds.has(row.id) && ["SCHEDULED", "CHECKED_IN", "COMPLETED"].includes(row.status)).reduce((sum, row) => sum + row.priceMinor, 0);
  return { scope, allowed: ["HELD", "REQUESTED", "CONFIRMED"].includes(booking.status) && targets.length > 0 && targets.every((row) => now.getTime() <= row.startsAt.getTime() - cutoffHours * 3_600_000),
    chargeMinor: charge, keptMinor: Math.max(0, charge - remainingPrice), refundMinor: refundDue(charge, booking), balanceMinor: balanceDue(charge, booking) };
}
