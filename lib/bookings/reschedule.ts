import type { Prisma } from "@prisma/client";
import { loadSchedule } from "@/lib/availability/context";
import { apportion } from "@/lib/payments/tax";
import { depositFor, type Quote } from "@/lib/pricing/quote";
import { isBookingOwner } from "./access";
import { staffCan, type Actor } from "./actor";
import { recomputeCharge } from "./charge";
import { defaultDb, lockBooking, lockSpaces, withTx, type DbOrTx } from "./db";
import { BookingError, forbidden, invalidState, mapSlotTaken, notFound } from "./errors";
import { recordBookingEvent } from "./events";
import { keptFee } from "./obligation";
import { enqueueBookingNotice } from "./notify";
import { payLaterDueAt } from "./paymentDue";
import { readPolicy } from "./pricingInputs";
import { quoteSlots } from "./quote";
import { refreshBlocking, releaseRows, bookingBlocks } from "./status";
import { assertNoConflicts, checkSlots, overrideRequested } from "./slotCheck";

/**
 * Move one occurrence (every unit of that slot) to a new time. Every rule is re-checked. The slot is repriced at
 * today's rates but with its original rate kind and the booking's frozen tax snapshot. `policyAnchorAt` keeps the
 * earliest start the slot ever had, so moving a booking later never escapes the cancellation tiers, and a cheaper
 * new slot keeps the tier's fee on the difference. A pay-later due date moves with the start. Returns the price
 * difference for Phase 2 to charge or refund.
 */

export type RescheduleInput = { makerspaceId: string; bookingId: string; occurrenceId: string; start: Date; end: Date; actor: Actor; overrideReason?: string | null; now?: Date };

export async function rescheduleOccurrence(input: RescheduleInput, db: DbOrTx = defaultDb()) {
  const now = input.now ?? new Date();
  const override = overrideRequested(input.actor, input.overrideReason);
  return mapSlotTaken(() =>
    withTx(db, async (tx) => {
      const booking = await lockBooking(tx, input.makerspaceId, input.bookingId);
      const staff = staffCan(input.actor, "bookings.manage");
      if (!staff && !isBookingOwner(booking, input.actor)) throw forbidden();
      if (booking.status !== "CONFIRMED" && booking.status !== "REQUESTED") throw invalidState("Only confirmed bookings and requests can be moved.");
      const anchor = await tx.bookingOccurrence.findFirst({ where: { id: input.occurrenceId, bookingId: booking.id } });
      if (!anchor) throw notFound("Occurrence");
      const rows = await tx.bookingOccurrence.findMany({ where: { bookingId: booking.id, slotIndex: anchor.slotIndex }, orderBy: { unit: "asc" } });
      if (rows.some((row) => row.status !== "SCHEDULED")) throw invalidState("Only upcoming times can be moved.");
      await lockSpaces(tx, [booking.spaceId]);
      const loaded = await loadSchedule(tx, { makerspaceId: input.makerspaceId, spaceId: booking.spaceId, from: input.start, to: input.end, now, bookingDurationMinutes: override ? undefined : (input.end.getTime() - input.start.getTime()) / 60_000, excludeOccurrenceIds: rows.map((row) => row.id), includeHidden: true });
      const rules = loaded.rules.values;
      if (!staff) {
        if (!rules.customerRescheduleAllowed) throw forbidden("This booking can't be moved online. Contact the makerspace.");
        if (now.getTime() > anchor.startsAt.getTime() - rules.customerRescheduleCutoffHours * 3_600_000) throw new BookingError("CUTOFF_PASSED", "It's too late to move this booking online. Contact the makerspace.");
      }
      const checked = checkSlots(loaded.schedule, [{ start: input.start, end: input.end, preferUnits: rows.map((row) => row.unit) }], rows.length, now, override);
      assertNoConflicts(checked);

      const snapshot = booking.priceSnapshot as unknown as Quote;
      const perSlotAddOns = (snapshot.addOns ?? []).map((entry) => ({ addOnId: entry.id, quantity: entry.quantity }));
      const perBooking = new Set((snapshot.lines ?? []).filter((line) => line.kind === "ADD_ON" && line.slotIndex === null).map((line) => line.refId));
      const quote = await quoteSlots(tx, {
        makerspaceId: input.makerspaceId,
        space: loaded.space,
        timeZone: loaded.timeZone,
        currency: booking.currency,
        rules,
        slots: [{ start: input.start, end: input.end, rateKind: anchor.rateKind }],
        quantity: rows.length,
        attendees: booking.attendees,
        addOns: perSlotAddOns.filter((entry) => !perBooking.has(entry.addOnId)),
        tax: snapshot.tax,
      });
      const oldSlotTotal = snapshot.slotTotals?.[anchor.slotIndex] ?? rows.reduce((sum, row) => sum + row.priceMinor, 0);
      const newSlotTotal = quote.slotTotals[0];
      const difference = newSlotTotal - oldSlotTotal;
      const parts = apportion(Math.abs(difference), rows.map(() => 1));
      const policy = readPolicy(booking.policySnapshot);
      const fee = difference < 0 && booking.status === "CONFIRMED" ? keptFee(-difference, policy.refundTiers, anchor.policyAnchorAt, now) : 0;

      await releaseRows(tx, rows.map((row) => row.id));
      const block = (time: Date, minutes: number) => new Date(time.getTime() + minutes * 60_000);
      for (const [index, row] of rows.entries()) {
        await tx.bookingOccurrence.update({
          where: { id: row.id },
          data: {
            startsAt: input.start,
            endsAt: input.end,
            blockStart: block(input.start, -rules.bufferBeforeMinutes),
            blockEnd: block(input.end, rules.bufferAfterMinutes),
            unit: checked.allocations[0]![index],
            priceMinor: Math.max(0, row.priceMinor + Math.sign(difference) * parts[index]),
            keptFeeMinor: row.keptFeeMinor + (index === 0 ? fee : 0),
            policyAnchorAt: input.start < row.policyAnchorAt ? input.start : row.policyAnchorAt,
            sequence: { increment: 1 },
          },
        });
      }
      await refreshBlocking(tx, booking.id, bookingBlocks(booking.status, rules.requestsBlockSlot));

      const lines = [...snapshot.lines.filter((line) => line.slotIndex !== anchor.slotIndex), ...quote.lines.map((line) => ({ ...line, slotIndex: line.slotIndex === null ? null : anchor.slotIndex }))];
      const slotTotals = [...(snapshot.slotTotals ?? [])];
      slotTotals[anchor.slotIndex] = newSlotTotal;
      const totalMinor = lines.reduce((sum, line) => sum + line.amountMinor, 0);
      const subtotalMinor = lines.reduce((sum, line) => sum + line.taxableMinor, 0);
      const first = await tx.bookingOccurrence.findFirst({ where: { bookingId: booking.id, status: { not: "CANCELLED" } }, orderBy: { startsAt: "asc" }, select: { startsAt: true } });
      const data: Prisma.BookingUpdateInput = {
        priceSnapshot: { ...snapshot, lines, slotTotals, totalMinor, subtotalMinor, taxMinor: totalMinor - subtotalMinor } as unknown as Prisma.InputJsonValue,
        totalMinor,
        subtotalMinor,
        taxMinor: totalMinor - subtotalMinor,
        depositMinor: booking.chargeMode === "DEPOSIT" ? depositFor(totalMinor, rules) : Math.min(booking.depositMinor, totalMinor),
      };
      if (booking.paymentDueAt && first && booking.paidMinor < booking.chargeMinor) {
        const moved = booking.payLater ? payLaterDueAt(rules, first.startsAt, booking.submittedAt ?? booking.createdAt) : new Date(Math.min(booking.paymentDueAt.getTime(), first.startsAt.getTime()));
        if (moved.getTime() !== booking.paymentDueAt.getTime()) data.paymentDueAt = moved;
      }
      await tx.booking.update({ where: { id: booking.id }, data });
      const charge = await recomputeCharge(tx, booking.id, { refundKind: "RESCHEDULE", actor: input.actor, now });
      // A dearer time on a booking paid upfront: the difference becomes due (staff are told when it runs late).
      if (charge.balanceDueMinor > 0 && booking.status === "CONFIRMED" && !booking.paymentDueAt && first) {
        data.paymentDueAt = new Date(Math.min(first.startsAt.getTime(), now.getTime() + rules.approvalPayWithinHours * 3_600_000));
        await tx.booking.update({ where: { id: booking.id }, data: { paymentDueAt: data.paymentDueAt, overdueAction: "NOTIFY_STAFF", paymentReminderSentAt: null, overdueNotifiedAt: null } });
      }
      await recordBookingEvent(tx, {
        makerspaceId: input.makerspaceId,
        bookingId: booking.id,
        kind: "rescheduled",
        actor: input.actor,
        occurrenceId: anchor.id,
        data: { from: { start: anchor.startsAt, end: anchor.endsAt }, to: { start: input.start, end: input.end }, priceDifferenceMinor: difference, keptFeeMinor: fee, overridden: checked.overridden.map((violation) => violation.code), overrideReason: checked.overridden.length ? input.overrideReason : null },
      });
      await enqueueBookingNotice(tx, { makerspaceId: input.makerspaceId, bookingId: booking.id, notice: "rescheduled", occurrenceIds: rows.map((row) => row.id) });
      return { priceDifferenceMinor: difference, keptFeeMinor: fee, chargeBeforeMinor: charge.before, chargeAfterMinor: charge.after, refundDueMinor: charge.refundDueMinor, balanceDueMinor: charge.balanceDueMinor, refundIds: charge.refundIds, paymentDueAt: (data.paymentDueAt as Date | undefined) ?? booking.paymentDueAt };
    }),
  );
}
