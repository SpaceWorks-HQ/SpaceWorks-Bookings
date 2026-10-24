import { addLocalDays, compareDates, dateKey, localToUtc, startOfLocalDay, weekdayOf, type LocalDate } from "./zoned";

/**
 * When a space is open, as merged UTC ranges, from weekly hours, dated exceptions and blackouts. Pure.
 *
 * - Weekly rows: weekday 0 (Sunday)–6, minutes from local midnight, close up to 1440 (24:00). No weekly rows at all
 *   means open all day, every day.
 * - An exception replaces that date's weekly hours: closed, or its own intervals.
 * - Blackouts remove time: whole local days (inclusive date range) or exact instants.
 * - Adjacent ranges merge, so 22:00–24:00 plus the next day's 00:00–06:00 is one range a booking may cross.
 * - DST: an opening takes the first of two equal local times, a closing the last; see lib/time/zoned.ts.
 */

export type TimeRange = { start: number; end: number };
export type MinuteInterval = { openMinute: number; closeMinute: number };
export type WeeklyHours = MinuteInterval & { weekday: number };
export type HoursExceptionInput = { date: string; closed: boolean; intervals: MinuteInterval[] };
export type BlackoutInput =
  | { kind: "DAYS"; startDate: string; endDate: string; reason?: string }
  | { kind: "TIMED"; startsAt: Date; endsAt: Date; reason?: string };

export const ALL_DAY: MinuteInterval[] = [{ openMinute: 0, closeMinute: 1440 }];

/** Sort and merge ranges that overlap or touch. */
export function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = ranges.filter((range) => range.end > range.start).sort((a, b) => a.start - b.start);
  const merged: TimeRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

/** `ranges` minus `holes` (both merged first). */
export function subtractRanges(ranges: TimeRange[], holes: TimeRange[]): TimeRange[] {
  const cut = mergeRanges(holes);
  const result: TimeRange[] = [];
  for (const range of mergeRanges(ranges)) {
    let start = range.start;
    for (const hole of cut) {
      if (hole.end <= start || hole.start >= range.end) continue;
      if (hole.start > start) result.push({ start, end: hole.start });
      start = Math.max(start, hole.end);
      if (start >= range.end) break;
    }
    if (start < range.end) result.push({ start, end: range.end });
  }
  return result;
}

/** The local intervals a date has: its exception if any, else its weekday's rows (none at all = all day). */
export function localDayIntervals(date: LocalDate, weekly: WeeklyHours[], exceptions: Map<string, HoursExceptionInput>): MinuteInterval[] {
  const exception = exceptions.get(dateKey(date));
  if (exception) return exception.closed ? [] : exception.intervals;
  if (weekly.length === 0) return ALL_DAY;
  const weekday = weekdayOf(date);
  return weekly.filter((row) => row.weekday === weekday);
}

/** Blackouts as UTC ranges in the timezone. */
export function blackoutRanges(blackouts: BlackoutInput[], timeZone: string): TimeRange[] {
  return blackouts.map((blackout) => {
    if (blackout.kind === "TIMED") return { start: blackout.startsAt.getTime(), end: blackout.endsAt.getTime() };
    const [from, to] = [blackout.startDate, blackout.endDate].map((value) => {
      const [year, month, day] = value.split("-").map(Number);
      return { year, month, day };
    });
    return { start: startOfLocalDay(from, timeZone).getTime(), end: startOfLocalDay(addLocalDays(to, 1), timeZone).getTime() };
  });
}

export type OpenIntervalsInput = {
  timeZone: string;
  /** First and last local dates to include (inclusive). Include a day either side to see ranges crossing midnight. */
  from: LocalDate;
  to: LocalDate;
  weekly: WeeklyHours[];
  exceptions: HoursExceptionInput[];
  blackouts: BlackoutInput[];
};

export function openIntervals(input: OpenIntervalsInput): TimeRange[] {
  const exceptions = new Map(input.exceptions.map((exception) => [exception.date, exception]));
  const ranges: TimeRange[] = [];
  for (let date = input.from; compareDates(date, input.to) <= 0; date = addLocalDays(date, 1)) {
    for (const interval of localDayIntervals(date, input.weekly, exceptions)) {
      if (interval.closeMinute <= interval.openMinute) continue;
      const start = localToUtc(date, interval.openMinute, input.timeZone, "first").getTime();
      const end = localToUtc(date, interval.closeMinute, input.timeZone, "last").getTime();
      if (end > start) ranges.push({ start, end });
    }
  }
  return subtractRanges(ranges, blackoutRanges(input.blackouts, input.timeZone));
}

/** The merged range that wholly contains [start, end), if any. */
export function containingRange(ranges: TimeRange[], start: number, end: number): TimeRange | null {
  return ranges.find((range) => range.start <= start && range.end >= end) ?? null;
}

/** Whether [start, end) overlaps any range. */
export function overlapsAny(ranges: TimeRange[], start: number, end: number): boolean {
  return ranges.some((range) => range.start < end && range.end > start);
}
