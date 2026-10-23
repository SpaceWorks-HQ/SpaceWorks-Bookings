import { prisma } from "@/lib/db";
import { loadSchedule } from "@/lib/availability/context";
import { expandRecurrence } from "@/lib/bookings/recurrence";
import { checkSlots } from "@/lib/bookings/slotCheck";
import { invalidInput } from "@/lib/bookings/errors";
import { parseDateKey } from "@/lib/time/zoned";

export async function publicBookingPlan(input: { makerspaceId: string; spaceId: string; timeZone: string; start: Date; end: Date; quantity: number;
  excludeBookingIds?: string[]; recurrence?: { frequency: "DAILY" | "WEEKLY"; interval?: number; count?: number; until?: string } | null }) {
  const probe = await loadSchedule(prisma, { ...input, from: input.start, to: input.end, bookingDurationMinutes: (input.end.getTime() - input.start.getTime()) / 60_000 });
  let slots;
  try {
    slots = expandRecurrence(input.start, input.end, input.timeZone, input.recurrence ? { ...input.recurrence, until: input.recurrence.until ? parseDateKey(input.recurrence.until)! : undefined } : null, probe.rules.values.recurrenceMaxOccurrences);
  } catch (error) { throw invalidInput(error instanceof Error ? error.message : "Choose valid repeat dates."); }
  if (!slots.length) throw invalidInput("Choose at least one date.");
  const loaded = slots.length > 1 ? await loadSchedule(prisma, { ...input, from: input.start, to: slots[slots.length - 1].end }) : probe;
  const checked = checkSlots(loaded.schedule, slots, input.quantity, new Date(), false);
  return { slots, checked };
}
