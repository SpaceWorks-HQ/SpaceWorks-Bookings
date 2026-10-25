import { addLocalDays, dateKey, localParts, parseDateKey, weekdayOf } from "@/lib/time/zoned";

/**
 * The staff calendar grid (pure): local days for a day or week view, and each occurrence placed on every local
 * day it touches (a booking across midnight shows on both days). Weeks start on Monday.
 */

export type CalendarView = "day" | "week";
export type GridItem = { id: string; spaceId: string; startsAt: number; endsAt: number };

export function calendarDays(day: string, view: CalendarView): string[] {
  const date = parseDateKey(day);
  if (!date) return [];
  const start = view === "week" ? addLocalDays(date, -((weekdayOf(date) + 6) % 7)) : date;
  return Array.from({ length: view === "week" ? 7 : 1 }, (_, index) => dateKey(addLocalDays(start, index)));
}

/** The day to show before/after this view. */
export function shiftDay(day: string, view: CalendarView, direction: 1 | -1): string {
  const date = parseDateKey(day);
  return date ? dateKey(addLocalDays(date, direction * (view === "week" ? 7 : 1))) : day;
}

export function placeOnGrid<T extends GridItem>(items: T[], days: string[], timeZone: string): Map<string, T[]> {
  const cells = new Map<string, T[]>();
  const wanted = new Set(days);
  for (const item of [...items].sort((a, b) => a.startsAt - b.startsAt)) {
    const first = localParts(item.startsAt, timeZone).date;
    const last = localParts(Math.max(item.startsAt, item.endsAt - 1), timeZone).date;
    for (let date = first, guard = 0; guard < 14; date = addLocalDays(date, 1), guard += 1) {
      const key = dateKey(date);
      if (wanted.has(key)) {
        const cell = `${item.spaceId}|${key}`;
        cells.set(cell, [...(cells.get(cell) ?? []), item]);
      }
      if (key === dateKey(last)) break;
    }
  }
  return cells;
}
