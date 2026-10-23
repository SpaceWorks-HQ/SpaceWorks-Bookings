"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { publicAction, publishedSpace, customerBooking, ownHoldExclusions } from "@/lib/actions/publicBookingContext";
import { publicBookingPlan } from "@/lib/actions/publicBookingPlan";
import { id, localDate, makerspaceSlug, quoteSchema, token } from "@/lib/actions/bookingInputs";
import { MAX_BOOKING_MINUTES } from "@/lib/bookings/inputBounds";
import { loadSchedule } from "@/lib/availability/context";
import { freeStartTimes } from "@/lib/availability/slots";
import { bookingDayWindow, conflictDates } from "@/lib/bookings/publicUi";
import { invalidInput } from "@/lib/bookings/errors";

const availabilitySchema = z.object({ makerspaceSlug, spaceId: id, date: localDate, duration: z.number().int().min(1).max(MAX_BOOKING_MINUTES), quantity: z.number().int().min(1).max(500),
  bookingId: id.optional(), manageToken: token.optional(), occurrenceId: id.optional() }).strict();

export async function loadBookingAvailability(input: unknown) {
  return publicAction(availabilitySchema, input, async (data, ctx) => {
    let excludeOccurrenceIds: string[] = [];
    let excludeBookingIds: string[] = [];
    if (data.occurrenceId) {
      const { booking } = await customerBooking(ctx.makerspaceId, ctx.actor, data);
      if (booking.spaceId !== data.spaceId) throw invalidInput("Choose the booked space.");
      const anchor = await prisma.bookingOccurrence.findFirst({ where: { makerspaceId: ctx.makerspaceId, bookingId: booking.id, id: data.occurrenceId } });
      if (!anchor) throw invalidInput("Choose a booking time.");
      excludeOccurrenceIds = (await prisma.bookingOccurrence.findMany({ where: { makerspaceId: ctx.makerspaceId, bookingId: booking.id, slotIndex: anchor.slotIndex }, select: { id: true } })).map((row) => row.id);
    } else {
      await publishedSpace(ctx.makerspaceId, data.spaceId);
      excludeBookingIds = await ownHoldExclusions(ctx.makerspaceId, ctx.actor, data);
    }
    const window = bookingDayWindow(data.date, ctx.timeZone);
    const loaded = await loadSchedule(prisma, { makerspaceId: ctx.makerspaceId, spaceId: data.spaceId, from: window.start,
      to: new Date(window.end.getTime() + data.duration * 60_000), bookingDurationMinutes: data.duration, excludeBookingIds, excludeOccurrenceIds, includeHidden: Boolean(data.occurrenceId) });
    return freeStartTimes(loaded.schedule, { from: window.start.getTime(), to: window.end.getTime(), durationMinutes: data.duration, quantity: data.quantity, now: Date.now() });
  }, { active: true });
}

export async function previewBookingConflicts(input: unknown) {
  return publicAction(quoteSchema, input, async (data, ctx) => {
    await publishedSpace(ctx.makerspaceId, data.spaceId);
    const excludeBookingIds = await ownHoldExclusions(ctx.makerspaceId, ctx.actor, data);
    const plan = await publicBookingPlan({ ...data, ...ctx, excludeBookingIds });
    return { conflicts: conflictDates(plan.checked.conflicts, ctx.timeZone), availableCount: plan.checked.allocations.filter(Boolean).length };
  }, { active: true });
}
