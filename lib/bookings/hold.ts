import type { BookingSource } from "@prisma/client";
import { loadSchedule } from "@/lib/availability/context";
import { parseDateKey } from "@/lib/time/zoned";
import { isStaff, staffCan, type Actor } from "./actor";
import { defaultDb, lockSpaces, withTx, type DbOrTx } from "./db";
import { forbidden, invalidInput, mapSlotTaken, type SlotConflict } from "./errors";
import { recordBookingEvent } from "./events";
import { releaseExpiredHoldsForSpace } from "./expiry";
import { loadPolicy } from "./pricingInputs";
import { expandRecurrence, RecurrenceError, type Recurrence } from "./recurrence";
import { assertNoConflicts, checkSlots, overrideRequested } from "./slotCheck";
import { newManageToken, newReference } from "./tokens";

/**
 * Step one of every booking: hold the slot(s) while the customer fills in details and pays. The hold is a HELD
 * booking whose occurrences block, released by `holdMinutes` (here, first, for this space, and by the beat job).
 * Recurring requests return their conflicts; pass `skipConflicts` to hold the rest.
 */

export type HoldInput = {
  makerspaceId: string;
  spaceId: string;
  actor: Actor;
  source: BookingSource;
  start: Date;
  end: Date;
  quantity?: number;
  recurrence?: { frequency: "DAILY" | "WEEKLY"; interval?: number; count?: number; until?: string } | null;
  skipConflicts?: boolean;
  /** Staff with `bookings.override` only: book despite rule violations (never overlaps). */
  overrideReason?: string | null;
  /** Defaults to the signed-in customer's account; required at submit anyway. */
  contact?: { name: string; email: string } | null;
  now?: Date;
};

export type HoldResult = {
  bookingId: string;
  reference: string;
  holdExpiresAt: Date;
  /** Shown once: lets a guest continue to submit. Submit issues the emailed one. */
  manageToken: string;
  occurrences: Array<{ id: string; slotIndex: number; unit: number; startsAt: Date; endsAt: Date }>;
  conflicts: SlotConflict[];
};

const PLACEHOLDER_CONTACT = { name: "Guest", email: "guest@hold.invalid" };

async function contactFor(db: DbOrTx, input: HoldInput) {
  if (input.contact) return { name: input.contact.name.trim(), email: input.contact.email.trim().toLowerCase() };
  if (input.actor.kind === "CUSTOMER" && input.actor.userId) {
    const user = await db.user.findUnique({ where: { id: input.actor.userId }, select: { name: true, email: true } });
    if (user?.email) return { name: user.name?.trim() || user.email, email: user.email.toLowerCase() };
  }
  return PLACEHOLDER_CONTACT;
}

function recurrenceOf(input: HoldInput): Recurrence | null {
  if (!input.recurrence) return null;
  const until = input.recurrence.until ? parseDateKey(input.recurrence.until) : undefined;
  if (input.recurrence.until && !until) throw invalidInput("Choose a valid end date for the series.");
  return { frequency: input.recurrence.frequency, interval: input.recurrence.interval, count: input.recurrence.count, until: until ?? undefined };
}

export async function createHold(input: HoldInput, db: DbOrTx = defaultDb()): Promise<HoldResult> {
  const now = input.now ?? new Date();
  const quantity = input.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1) throw invalidInput("Book at least one.");
  if (isStaff(input.actor) ? !staffCan(input.actor, "bookings.manage") : input.source === "STAFF") throw forbidden();
  const override = overrideRequested(input.actor, input.overrideReason);
  const contact = await contactFor(db, input);

  return mapSlotTaken(() =>
    withTx(db, async (tx) => {
      await releaseExpiredHoldsForSpace(tx, input.spaceId, now);
      await lockSpaces(tx, [input.spaceId]);
      const probe = await loadSchedule(tx, { makerspaceId: input.makerspaceId, spaceId: input.spaceId, from: input.start, to: input.end, includeHidden: isStaff(input.actor) });
      const rules = probe.rules.values;
      const guest = input.actor.kind === "CUSTOMER" && !input.actor.userId;
      if (guest && !rules.guestBookingAllowed) throw forbidden("Sign in to book this space.");
      if (quantity > probe.space.units) throw invalidInput(`Only ${probe.space.units} can be booked at once.`);
      let planned;
      try {
        planned = expandRecurrence(input.start, input.end, probe.timeZone, recurrenceOf(input), rules.recurrenceMaxOccurrences);
      } catch (error) {
        if (error instanceof RecurrenceError) throw invalidInput(error.message);
        throw error;
      }
      const last = planned[planned.length - 1];
      const loaded = planned.length > 1 ? await loadSchedule(tx, { makerspaceId: input.makerspaceId, spaceId: input.spaceId, from: input.start, to: last.end, includeHidden: isStaff(input.actor) }) : probe;
      const checked = checkSlots(loaded.schedule, planned, quantity, now, override);
      if (checked.conflicts.length && !input.skipConflicts) assertNoConflicts(checked);
      const kept = planned.map((slot, index) => ({ ...slot, units: checked.allocations[index] })).filter((slot) => slot.units);
      if (kept.length === 0) assertNoConflicts(checked);

      const token = newManageToken();
      let reference = newReference();
      while (await tx.booking.findFirst({ where: { makerspaceId: input.makerspaceId, reference }, select: { id: true } })) reference = newReference();
      const holdExpiresAt = new Date(now.getTime() + rules.holdMinutes * 60_000);
      const policy = await loadPolicy(tx, input.makerspaceId, input.spaceId, rules);
      const booking = await tx.booking.create({
        data: {
          makerspaceId: input.makerspaceId,
          spaceId: input.spaceId,
          reference,
          status: "HELD",
          source: input.source,
          customerUserId: input.actor.kind === "CUSTOMER" ? input.actor.userId : null,
          contactName: contact.name,
          contactEmail: contact.email,
          quantity,
          currency: loaded.currency,
          chargeMode: rules.chargeMode,
          allowPayLater: rules.allowPayLater,
          policySnapshot: policy,
          holdExpiresAt,
          manageTokenHash: token.hash,
          createdById: isStaff(input.actor) ? input.actor.userId : null,
          overrideReason: checked.overridden.length ? input.overrideReason!.trim() : null,
        },
      });
      const buffer = (minutes: number) => minutes * 60_000;
      await tx.bookingOccurrence.createMany({
        data: kept.flatMap((slot, slotIndex) =>
          slot.units!.map((unit) => ({
            makerspaceId: input.makerspaceId,
            bookingId: booking.id,
            spaceId: input.spaceId,
            slotIndex,
            unit,
            startsAt: slot.start,
            endsAt: slot.end,
            blockStart: new Date(slot.start.getTime() - buffer(rules.bufferBeforeMinutes)),
            blockEnd: new Date(slot.end.getTime() + buffer(rules.bufferAfterMinutes)),
            blocking: true,
            policyAnchorAt: slot.start,
          })),
        ),
      });
      await recordBookingEvent(tx, {
        makerspaceId: input.makerspaceId,
        bookingId: booking.id,
        kind: "held",
        actor: input.actor,
        data: { slots: kept.length, skipped: checked.conflicts.length, quantity, overridden: checked.overridden.map((violation) => violation.code), overrideReason: booking.overrideReason },
      });
      const occurrences = await tx.bookingOccurrence.findMany({ where: { bookingId: booking.id }, orderBy: [{ slotIndex: "asc" }, { unit: "asc" }], select: { id: true, slotIndex: true, unit: true, startsAt: true, endsAt: true } });
      return { bookingId: booking.id, reference, holdExpiresAt, manageToken: token.token, occurrences, conflicts: checked.conflicts };
    }),
  );
}
