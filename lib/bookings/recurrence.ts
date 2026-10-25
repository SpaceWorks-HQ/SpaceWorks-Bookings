import { addLocalDays, compareDates, daysBetween, localParts, resolveLocal, type LocalDate } from "@/lib/time/zoned";

/**
 * Recurring bookings keep the local wall-clock times of the first slot (a 09:00–11:00 booking stays 09:00–11:00
 * across a DST change). A slot whose start or end doesn't exist that day (spring gap) is marked `nonexistent` and
 * becomes a conflict. Pure.
 */

export type Recurrence = { frequency: "DAILY" | "WEEKLY"; interval?: number; count?: number; until?: LocalDate };
export type ExpandedSlot = { start: Date; end: Date; nonexistent: boolean };

export class RecurrenceError extends Error {
  override name = "RecurrenceError";
}

export function expandRecurrence(start: Date, end: Date, timeZone: string, recurrence: Recurrence | null | undefined, maxOccurrences: number): ExpandedSlot[] {
  if (!recurrence) return [{ start, end, nonexistent: false }];
  const interval = recurrence.interval ?? 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 12) throw new RecurrenceError("Repeat every 1 to 12 days or weeks.");
  if (recurrence.count == null && !recurrence.until) throw new RecurrenceError("Say how many times to repeat, or until when.");
  if (recurrence.count != null && (!Number.isInteger(recurrence.count) || recurrence.count < 1)) throw new RecurrenceError("Repeat at least once.");
  const step = (recurrence.frequency === "WEEKLY" ? 7 : 1) * interval;
  const first = localParts(start, timeZone);
  const last = localParts(end, timeZone);
  const endDayOffset = daysBetween(first.date, last.date);
  const slots: ExpandedSlot[] = [];
  for (let index = 0; ; index += 1) {
    const date = addLocalDays(first.date, index * step);
    if (recurrence.count != null && index >= recurrence.count) break;
    if (recurrence.until && compareDates(date, recurrence.until) > 0) break;
    if (slots.length >= maxOccurrences) throw new RecurrenceError(`A series can have at most ${maxOccurrences} bookings.`);
    const from = resolveLocal(date, first.minute, timeZone, "first");
    const to = resolveLocal(addLocalDays(date, endDayOffset), last.minute, timeZone, "last");
    slots.push({ start: from.instant, end: to.instant, nonexistent: from.kind === "nonexistent" || to.kind === "nonexistent" });
  }
  return slots;
}
