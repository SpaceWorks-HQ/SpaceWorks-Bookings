import { loadRules } from "@/lib/availability/context";
import { requireStaffOrSystem, staffCan, type Actor } from "./actor";
import { recomputeCharge } from "./charge";
import { defaultDb, lockBooking, withTx, type DbOrTx, type Tx } from "./db";
import { forbidden, invalidInput, invalidState, notFound } from "./errors";
import { recordBookingEvent } from "./events";
import { enqueueBookingNotice } from "./notify";
import { setOccurrenceStatus } from "./status";
import { verifyCheckInCode } from "./tokens";

/**
 * Check-in and no-shows. Staff check people in from the day sheet (an occurrence id) or by scanning the check-in
 * code; customers may check themselves in with the code inside the self check-in window when the space allows it.
 * A no-show is marked by staff once the start plus the grace period has passed, or by the auto no-show job. With
 * `noShowReleasesSlot` off the slot stays held (`noShowAt` set) until it ends, then becomes NO_SHOW.
 */

export type CheckInInput = { makerspaceId: string; actor: Actor; occurrenceId?: string; code?: string; now?: Date };

const MINUTE = 60_000;

async function rowsForCode(tx: Tx, makerspaceId: string, code: string, now: Date) {
  const reference = verifyCheckInCode(makerspaceId, code);
  if (!reference) throw invalidInput("That check-in code isn't valid.");
  const booking = await tx.booking.findFirst({ where: { makerspaceId, reference }, select: { id: true } });
  if (!booking) throw notFound();
  // The slot on now: the earliest scheduled one that hasn't ended.
  const next = await tx.bookingOccurrence.findFirst({ where: { bookingId: booking.id, status: "SCHEDULED", endsAt: { gt: now } }, orderBy: { startsAt: "asc" } });
  if (!next) throw invalidState("There's nothing to check in to on this booking.");
  return { bookingId: booking.id, slotIndex: next.slotIndex };
}

export async function checkIn(input: CheckInInput, db: DbOrTx = defaultDb()) {
  const now = input.now ?? new Date();
  const staff = staffCan(input.actor, "bookings.manage");
  if (!staff && (input.actor.kind !== "CUSTOMER" || !input.code)) throw forbidden();
  return withTx(db, async (tx) => {
    let target: { bookingId: string; slotIndex: number };
    if (input.code) target = await rowsForCode(tx, input.makerspaceId, input.code, now);
    else {
      const row = input.occurrenceId ? await tx.bookingOccurrence.findFirst({ where: { id: input.occurrenceId, makerspaceId: input.makerspaceId } }) : null;
      if (!row) throw notFound("Occurrence");
      target = { bookingId: row.bookingId, slotIndex: row.slotIndex };
    }
    const booking = await lockBooking(tx, input.makerspaceId, target.bookingId);
    if (booking.status !== "CONFIRMED") throw invalidState("Only confirmed bookings can be checked in.");
    const rows = await tx.bookingOccurrence.findMany({ where: { bookingId: booking.id, slotIndex: target.slotIndex, status: "SCHEDULED" } });
    if (rows.length === 0) throw invalidState("This time is already checked in or over.");
    const { startsAt, endsAt } = rows[0];
    if (!staff) {
      const space = await tx.space.findFirstOrThrow({ where: { id: booking.spaceId, makerspaceId: input.makerspaceId } });
      const rules = (await loadRules(tx, input.makerspaceId, space)).values;
      if (!rules.selfCheckInEnabled) throw forbidden("Check in at the front desk.");
      const opens = startsAt.getTime() - rules.selfCheckInOpensMinutesBefore * MINUTE;
      const closes = startsAt.getTime() + rules.selfCheckInClosesMinutesAfter * MINUTE;
      if (now.getTime() < opens || now.getTime() > closes) throw invalidState("Self check-in isn't open for this booking right now.");
    } else if (now >= endsAt || now.getTime() < startsAt.getTime() - 24 * 60 * MINUTE) {
      throw invalidState("Check-in opens on the day and closes when the booking ends.");
    }
    await setOccurrenceStatus(tx, rows, "CHECKED_IN", { checkedInAt: now, checkedInById: input.actor.kind === "STAFF" ? input.actor.userId : null, noShowAt: null, noShowById: null });
    await recordBookingEvent(tx, { makerspaceId: input.makerspaceId, bookingId: booking.id, occurrenceId: rows[0].id, kind: "checked-in", actor: input.actor, data: { self: !staff, units: rows.length } });
    await enqueueBookingNotice(tx, { makerspaceId: input.makerspaceId, bookingId: booking.id, notice: "checked-in", occurrenceIds: rows.map((row) => row.id) });
    return { bookingId: booking.id, occurrenceIds: rows.map((row) => row.id) };
  });
}

export async function markNoShow(input: { makerspaceId: string; occurrenceId: string; actor: Actor; now?: Date }, db: DbOrTx = defaultDb()) {
  const now = input.now ?? new Date();
  requireStaffOrSystem(input.actor, "bookings.manage");
  return withTx(db, async (tx) => {
    const row = await tx.bookingOccurrence.findFirst({ where: { id: input.occurrenceId, makerspaceId: input.makerspaceId } });
    if (!row) throw notFound("Occurrence");
    const booking = await lockBooking(tx, input.makerspaceId, row.bookingId);
    if (booking.status !== "CONFIRMED") throw invalidState("Only confirmed bookings can be marked as no-shows.");
    const rows = await tx.bookingOccurrence.findMany({ where: { bookingId: booking.id, slotIndex: row.slotIndex, status: "SCHEDULED", noShowAt: null } });
    if (rows.length === 0) throw invalidState("This time is already checked in, marked or over.");
    const space = await tx.space.findFirstOrThrow({ where: { id: booking.spaceId, makerspaceId: input.makerspaceId } });
    const rules = (await loadRules(tx, input.makerspaceId, space)).values;
    if (now.getTime() < rows[0].startsAt.getTime() + rules.noShowGraceMinutes * MINUTE) throw invalidState(`Wait ${rules.noShowGraceMinutes} minutes after the start before marking a no-show.`);
    const by = input.actor.kind === "STAFF" ? input.actor.userId : null;
    if (rules.noShowReleasesSlot || now >= rows[0].blockEnd) await setOccurrenceStatus(tx, rows, "NO_SHOW", { noShowAt: now, noShowById: by });
    else await tx.bookingOccurrence.updateMany({ where: { id: { in: rows.map((item) => item.id) } }, data: { noShowAt: now, noShowById: by } });
    const charge = await recomputeCharge(tx, booking.id);
    await recordBookingEvent(tx, { makerspaceId: input.makerspaceId, bookingId: booking.id, occurrenceId: rows[0].id, kind: "no-show", actor: input.actor, data: { units: rows.length, releasesSlot: rules.noShowReleasesSlot, chargeAfter: charge.after } });
    return { bookingId: booking.id, occurrenceIds: rows.map((item) => item.id), chargeMinor: charge.after };
  });
}
