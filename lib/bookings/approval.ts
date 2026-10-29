import { loadRules, loadSchedule } from "@/lib/availability/context";
import { requireStaff, staffCan, SYSTEM, type Actor } from "./actor";
import { recomputeCharge } from "./charge";
import { defaultDb, lockBooking, lockSpaces, withTx, type DbOrTx, type Tx } from "./db";
import { forbidden, invalidInput, invalidState, mapSlotTaken } from "./errors";
import { recordBookingEvent } from "./events";
import { runBookingConfirmed } from "./hooks";
import { enqueueBookingNotice } from "./notify";
import { approvalDueAt, payLaterDueAt } from "./paymentDue";
import { hasRequiredUpfrontPayment } from "./money/confirmation";
import { groupSlots, setRowUnits } from "./rows";
import { assertNoConflicts, checkSlots, overrideRequested } from "./slotCheck";
import { refreshBlocking, releaseRows, setBookingStatus } from "./status";

/**
 * Approving re-checks every rule (lead time, advance window, durations, hours, blackouts and overlaps) against the
 * schedule as it is now, and re-allocates units where needed. Then money becomes due: pay later by its rule,
 * PAY_NOW/DEPOSIT within `approvalPayWithinHours` (overdue → auto-cancel). Declining needs a reason.
 * `confirmPaidBooking` is Phase 2's entry point once an upfront payment settles.
 */

export type ApproveInput = { makerspaceId: string; bookingId: string; actor: Actor; overrideReason?: string | null; now?: Date };

export async function approveBooking(input: ApproveInput, db: DbOrTx = defaultDb()) {
  const now = input.now ?? new Date();
  requireStaff(input.actor, "bookings.approve");
  const override = overrideRequested(input.actor, input.overrideReason);
  return mapSlotTaken(() =>
    withTx(db, async (tx) => {
      const booking = await lockBooking(tx, input.makerspaceId, input.bookingId);
      if (booking.status !== "REQUESTED") throw invalidState("Only requests can be approved.");
      await lockSpaces(tx, [booking.spaceId]);
      const rows = await tx.bookingOccurrence.findMany({ where: { bookingId: booking.id, status: "SCHEDULED" } });
      if (rows.length === 0) throw invalidState("This request has no times left to approve.");
      const slots = groupSlots(rows);
      const loaded = await loadSchedule(tx, { makerspaceId: input.makerspaceId, spaceId: booking.spaceId, from: slots[0][0].startsAt, to: slots[slots.length - 1][0].endsAt, excludeBookingIds: [booking.id], includeHidden: true });
      const checked = checkSlots(loaded.schedule, slots.map((slot) => ({ start: slot[0].startsAt, end: slot[0].endsAt, preferUnits: slot.map((row) => row.unit) })), booking.quantity, now, override);
      assertNoConflicts(checked);
      await releaseRows(tx, rows.map((row) => row.id));
      await setRowUnits(tx, slots.flatMap((slot, index) => slot.map((row, unitIndex) => ({ id: row.id, unit: checked.allocations[index]![unitIndex] }))));

      const rules = loaded.rules.values;
      const firstStart = slots[0][0].startsAt;
      const upfront = booking.chargeMode === "PAY_NOW" || booking.chargeMode === "DEPOSIT";
      const gateway = (await tx.makerspacePaymentSettings.findUnique({ where: { makerspaceId: input.makerspaceId }, select: { provider: true } }))?.provider ?? "NONE";
      const payLater = booking.payLater || booking.chargeMode === "PAY_LATER" || (upfront && gateway === "NONE");
      const owes = booking.totalMinor > 0 && booking.chargeMode !== "FREE";
      const paymentDueAt = !owes ? null : payLater ? payLaterDueAt(rules, firstStart, now) : approvalDueAt(rules, firstStart, now);
      await setBookingStatus(tx, booking, "CONFIRMED", {
        requestsBlockSlot: rules.requestsBlockSlot,
        now,
        data: {
          approvedAt: now,
          approvedById: input.actor.kind === "STAFF" ? input.actor.userId : null,
          confirmedAt: now,
          requestExpiresAt: null,
          payLater,
          paymentDueAt,
          overdueAction: !owes ? null : payLater ? rules.overdueAction : "AUTO_CANCEL",
          ...(checked.overridden.length ? { overrideReason: input.overrideReason!.trim() } : {}),
        },
      });
      await recomputeCharge(tx, booking.id);
      await recordBookingEvent(tx, { makerspaceId: input.makerspaceId, bookingId: booking.id, kind: "approved", actor: input.actor, data: { paymentDueAt, payLater, overridden: checked.overridden.map((violation) => violation.code) } });
      await enqueueBookingNotice(tx, { makerspaceId: input.makerspaceId, bookingId: booking.id, notice: "approved" });
      await runBookingConfirmed(tx, booking.id);
      return tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
    }),
  );
}

export async function declineBooking(input: { makerspaceId: string; bookingId: string; actor: Actor; reason: string; now?: Date }, db: DbOrTx = defaultDb()) {
  const now = input.now ?? new Date();
  const staff = requireStaff(input.actor, "bookings.approve");
  const reason = input.reason?.trim() ?? "";
  if (!reason || reason.length > 1000) throw invalidInput("Say why the request is declined (up to 1,000 characters).");
  return withTx(db, async (tx) => {
    const booking = await lockBooking(tx, input.makerspaceId, input.bookingId);
    if (booking.status !== "REQUESTED") throw invalidState("Only requests can be declined.");
    await setBookingStatus(tx, booking, "DECLINED", { requestsBlockSlot: false, now, data: { declinedAt: now, declinedById: staff.userId, declineReason: reason, requestExpiresAt: null }, cancelKind: "STAFF" });
    await recomputeCharge(tx, booking.id);
    await recordBookingEvent(tx, { makerspaceId: input.makerspaceId, bookingId: booking.id, kind: "declined", actor: input.actor, data: { reason } });
    await enqueueBookingNotice(tx, { makerspaceId: input.makerspaceId, bookingId: booking.id, notice: "declined", reason });
    return tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
  });
}

/**
 * Phase 2: an upfront payment (PAY_NOW or DEPOSIT) for a HELD booking settled. Confirms it in the caller's
 * transaction (lock order: Booking first, then Payments). A hold that already expired is not confirmed here: the
 * caller handles late captures (re-block or refund).
 */
export async function confirmPaidBooking(tx: Tx, input: { makerspaceId: string; bookingId: string; actor?: Actor; now?: Date }) {
  const now = input.now ?? new Date();
  const actor = input.actor ?? SYSTEM;
  if (actor.kind === "STAFF" && !staffCan(actor, "payments.record")) throw forbidden();
  const booking = await lockBooking(tx, input.makerspaceId, input.bookingId);
  if (booking.status === "CONFIRMED") return booking;
  if (booking.status !== "HELD" || !booking.awaitingPayment) throw invalidState("This booking isn't waiting for a payment.");
  if (!(await hasRequiredUpfrontPayment(tx, booking))) throw invalidState("The required upfront payment hasn't been received and reviewed yet.");
  const space = await tx.space.findFirstOrThrow({ where: { id: booking.spaceId, makerspaceId: input.makerspaceId } });
  const rules = (await loadRules(tx, input.makerspaceId, space)).values;
  await setBookingStatus(tx, booking, "CONFIRMED", { requestsBlockSlot: rules.requestsBlockSlot, now, data: { awaitingPayment: false, confirmedAt: now, holdExpiresAt: booking.holdExpiresAt } });
  await refreshBlocking(tx, booking.id, true);
  await recomputeCharge(tx, booking.id, { refundKind: "DUPLICATE", now });
  await recordBookingEvent(tx, { makerspaceId: input.makerspaceId, bookingId: booking.id, kind: "confirmed", actor, data: { paid: true } });
  await enqueueBookingNotice(tx, { makerspaceId: input.makerspaceId, bookingId: booking.id, notice: "confirmed" });
  await runBookingConfirmed(tx, booking.id);
  return tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
}
