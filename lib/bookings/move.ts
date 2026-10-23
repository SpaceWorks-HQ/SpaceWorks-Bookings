import { loadSchedule } from "@/lib/availability/context";
import { requireStaff, type Actor } from "./actor";
import { defaultDb, lockBooking, lockSpaces, withTx, type DbOrTx } from "./db";
import { invalidInput, invalidState, mapSlotTaken } from "./errors";
import { recordBookingEvent } from "./events";
import { enqueueBookingNotice } from "./notify";
import { groupSlots, setRowUnits } from "./rows";
import { assertNoConflicts, checkSlots, overrideRequested } from "./slotCheck";
import { bookingBlocks, refreshBlocking, releaseRows } from "./status";

/**
 * Staff move a whole booking to another space of the same makerspace (a leak in Studio A, say). Every upcoming slot
 * is re-checked in the new space and given units there; the price stays as agreed. The occurrences follow the
 * booking through the composite foreign key (ON UPDATE CASCADE).
 */

export type MoveInput = { makerspaceId: string; bookingId: string; toSpaceId: string; actor: Actor; overrideReason?: string | null; now?: Date };

export async function moveBooking(input: MoveInput, db: DbOrTx = defaultDb()) {
  const now = input.now ?? new Date();
  requireStaff(input.actor, "bookings.manage");
  const override = overrideRequested(input.actor, input.overrideReason);
  return mapSlotTaken(() =>
    withTx(db, async (tx) => {
      const booking = await lockBooking(tx, input.makerspaceId, input.bookingId);
      if (booking.status !== "CONFIRMED" && booking.status !== "REQUESTED") throw invalidState("Only confirmed bookings and requests can be moved.");
      if (booking.spaceId === input.toSpaceId) throw invalidInput("Choose a different space.");
      await lockSpaces(tx, [booking.spaceId, input.toSpaceId]);
      const rows = await tx.bookingOccurrence.findMany({ where: { bookingId: booking.id, status: "SCHEDULED" } });
      if (rows.length === 0) throw invalidState("There's nothing upcoming to move.");
      const slots = groupSlots(rows);
      const loaded = await loadSchedule(tx, { makerspaceId: input.makerspaceId, spaceId: input.toSpaceId, from: slots[0][0].startsAt, to: slots[slots.length - 1][0].endsAt, excludeBookingIds: [booking.id], includeHidden: true });
      if (loaded.space.archivedAt) throw invalidInput("That space is archived.");
      if (booking.quantity > loaded.space.units) throw invalidInput(`${loaded.space.name} has only ${loaded.space.units} units.`);
      const checked = checkSlots(loaded.schedule, slots.map((slot) => ({ start: slot[0].startsAt, end: slot[0].endsAt })), booking.quantity, now, override);
      assertNoConflicts(checked);
      const rules = loaded.rules.values;

      await releaseRows(tx, rows.map((row) => row.id));
      await tx.booking.update({ where: { id: booking.id }, data: { spaceId: input.toSpaceId } });
      await setRowUnits(tx, slots.flatMap((slot, index) => slot.map((row, unitIndex) => ({ id: row.id, unit: checked.allocations[index]![unitIndex] }))));
      // The new space's buffers apply from now on.
      for (const slot of slots) {
        await tx.bookingOccurrence.updateMany({
          where: { id: { in: slot.map((row) => row.id) } },
          data: { blockStart: new Date(slot[0].startsAt.getTime() - rules.bufferBeforeMinutes * 60_000), blockEnd: new Date(slot[0].endsAt.getTime() + rules.bufferAfterMinutes * 60_000), sequence: { increment: 1 } },
        });
      }
      await refreshBlocking(tx, booking.id, bookingBlocks(booking.status, rules.requestsBlockSlot));
      await recordBookingEvent(tx, { makerspaceId: input.makerspaceId, bookingId: booking.id, kind: "moved", actor: input.actor, data: { fromSpaceId: booking.spaceId, toSpaceId: input.toSpaceId, overridden: checked.overridden.map((violation) => violation.code), overrideReason: checked.overridden.length ? input.overrideReason : null } });
      await enqueueBookingNotice(tx, { makerspaceId: input.makerspaceId, bookingId: booking.id, notice: "rescheduled", occurrenceIds: rows.map((row) => row.id) });
      return tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
    }),
  );
}
