import type { BookingOccurrence, CancelKind } from "@prisma/client";
import { loadRules } from "@/lib/availability/context";
import { isBookingOwner } from "./access";
import { requireStaff, type Actor } from "./actor";
import { recomputeCharge } from "./charge";
import { defaultDb, lockBooking, withTx, type DbOrTx } from "./db";
import { BookingError, forbidden, invalidInput, invalidState, notFound } from "./errors";
import { recordBookingEvent } from "./events";
import { keptFee } from "./obligation";
import { enqueueBookingNotice } from "./notify";
import { readPolicy } from "./pricingInputs";
import { setBookingStatus, setOccurrenceStatus } from "./status";

/**
 * Cancel a whole booking, one occurrence (every unit of that slot) or one and all later ones.
 * - CUSTOMER: the booker, before `customerCancelCutoffHours`; the refund policy applies.
 * - STAFF: `bookings.manage`, for the customer (any time; the policy applies).
 * - VENUE: `bookings.override`; nothing is kept (everything paid comes back).
 * - SYSTEM: jobs (an overdue pay-later booking); the policy applies.
 * Kept fees come from the booking's frozen refund tiers counted from each row's `policyAnchorAt`; requests and
 * holds owe nothing. When no occurrence is left the booking is CANCELLED.
 */

export type CancelScope = { type: "ALL" } | { type: "OCCURRENCE"; occurrenceId: string } | { type: "FOLLOWING"; occurrenceId: string };
export type CancelInput = { makerspaceId: string; bookingId: string; actor: Actor; kind: CancelKind; scope?: CancelScope; reason?: string | null; now?: Date };

function authorise(input: CancelInput, booking: Parameters<typeof isBookingOwner>[0]) {
  if (input.kind === "CUSTOMER") {
    if (!isBookingOwner(booking, input.actor)) throw forbidden();
  } else if (input.kind === "STAFF") requireStaff(input.actor, "bookings.manage");
  else if (input.kind === "VENUE") requireStaff(input.actor, "bookings.override");
  else if (input.actor.kind !== "SYSTEM") throw forbidden();
}

function targetRows(rows: BookingOccurrence[], scope: CancelScope): BookingOccurrence[] {
  const scheduled = rows.filter((row) => row.status === "SCHEDULED");
  if (scope.type === "ALL") return scheduled;
  const anchor = rows.find((row) => row.id === scope.occurrenceId);
  if (!anchor) throw notFound("Occurrence");
  if (scope.type === "OCCURRENCE") return scheduled.filter((row) => row.slotIndex === anchor.slotIndex);
  return scheduled.filter((row) => row.startsAt >= anchor.startsAt);
}

export async function cancelBooking(input: CancelInput, db: DbOrTx = defaultDb()) {
  const now = input.now ?? new Date();
  const scope = input.scope ?? { type: "ALL" };
  const reason = input.reason?.trim() || null;
  if (reason && reason.length > 1000) throw invalidInput("Keep the reason under 1,000 characters.");
  if (input.kind === "VENUE" && !reason) throw invalidInput("Say why the venue is cancelling.");
  return withTx(db, async (tx) => {
    const booking = await lockBooking(tx, input.makerspaceId, input.bookingId);
    authorise(input, booking);
    if (!["HELD", "REQUESTED", "CONFIRMED"].includes(booking.status)) throw invalidState("This booking can't be cancelled any more.");
    const rows = await tx.bookingOccurrence.findMany({ where: { bookingId: booking.id } });
    const targets = targetRows(rows, scope);
    if (targets.length === 0) throw invalidState("There's nothing left to cancel.");
    const space = await tx.space.findFirstOrThrow({ where: { id: booking.spaceId, makerspaceId: input.makerspaceId } });
    const rules = (await loadRules(tx, input.makerspaceId, space)).values;
    if (input.kind === "CUSTOMER") {
      const first = Math.min(...targets.map((row) => row.startsAt.getTime()));
      if (now.getTime() > first - rules.customerCancelCutoffHours * 3_600_000) throw new BookingError("CUTOFF_PASSED", "It's too late to cancel online. Contact the makerspace.");
    }
    const policy = readPolicy(booking.policySnapshot);
    const keepsFees = booking.status === "CONFIRMED" && input.kind !== "VENUE";
    for (const row of targets) {
      const fee = keepsFees ? keptFee(row.priceMinor, policy.refundTiers, row.policyAnchorAt, now) : 0;
      await setOccurrenceStatus(tx, [row], "CANCELLED", { cancelledAt: now, cancelKind: input.kind, keptFeeMinor: row.keptFeeMinor + fee, sequence: { increment: 1 } });
    }
    const remaining = rows.filter((row) => row.status !== "CANCELLED" && !targets.some((target) => target.id === row.id));
    const whole = remaining.length === 0;
    if (whole) {
      await setBookingStatus(tx, booking, "CANCELLED", {
        requestsBlockSlot: rules.requestsBlockSlot,
        now,
        data: { cancelledAt: now, cancelledById: input.actor.kind === "STAFF" || input.actor.kind === "CUSTOMER" ? input.actor.userId : null, cancelKind: input.kind, cancelReason: reason, awaitingPayment: false, requestExpiresAt: null },
        cancelKind: input.kind,
      });
    }
    const charge = await recomputeCharge(tx, booking.id);
    const keptFeeMinor = (await tx.bookingOccurrence.aggregate({ where: { id: { in: targets.map((row) => row.id) } }, _sum: { keptFeeMinor: true } }))._sum.keptFeeMinor ?? 0;
    await recordBookingEvent(tx, {
      makerspaceId: input.makerspaceId,
      bookingId: booking.id,
      kind: "cancelled",
      actor: input.actor,
      occurrenceId: scope.type === "ALL" ? null : scope.occurrenceId,
      data: { scope: scope.type, kind: input.kind, occurrences: targets.length, whole, keptFeeMinor, chargeBefore: charge.before, chargeAfter: charge.after, reason },
    });
    if (booking.status !== "HELD") {
      await enqueueBookingNotice(tx, { makerspaceId: input.makerspaceId, bookingId: booking.id, notice: "cancelled", occurrenceIds: targets.map((row) => row.id), keptFeeMinor, refundDueMinor: charge.refundDueMinor, balanceDueMinor: charge.balanceDueMinor, ...(reason && input.kind === "VENUE" ? { reason } : {}) });
    }
    const saved = await tx.booking.findUniqueOrThrow({ where: { id: booking.id }, select: { status: true } });
    return { bookingStatus: saved.status, cancelledOccurrenceIds: targets.map((row) => row.id), keptFeeMinor, chargeBeforeMinor: charge.before, chargeAfterMinor: charge.after, refundDueMinor: charge.refundDueMinor, balanceDueMinor: charge.balanceDueMinor };
  });
}
