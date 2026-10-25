/**
 * Calendar-date maths in a makerspace's timezone. Pure and client-safe. A day boundary is the start of a
 * calendar day in the timezone, stored as a UTC instant.
 */

export type CalendarDate = { year: number; month: number; day: number };

const DAY_MS = 86_400_000;

function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** The calendar date an instant falls on in a timezone. */
export function localDate(instant: Date, timeZone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** 00:00 on a calendar date in a timezone, as a UTC instant. Handles DST by re-checking the offset. */
export function startOfLocalDay(date: CalendarDate, timeZone: string): Date {
  const guess = Date.UTC(date.year, date.month - 1, date.day);
  let instant = guess - offsetMinutes(new Date(guess), timeZone) * 60_000;
  const corrected = guess - offsetMinutes(new Date(instant), timeZone) * 60_000;
  if (corrected !== instant) instant = corrected;
  return new Date(instant);
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Add calendar months, clamping the day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: CalendarDate, months: number): CalendarDate {
  const index = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * DAY_MS);
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

/** The first day of the financial year that contains `date`. India: 1 April. */
export function financialYearStart(date: CalendarDate, startMonth: number): CalendarDate {
  const year = date.month >= startMonth ? date.year : date.year - 1;
  return { year, month: startMonth, day: 1 };
}

/** "2026-27" for the year starting April 2026; "2026" when the year starts in January. */
export function financialYearLabel(date: CalendarDate, startMonth: number): string {
  const start = financialYearStart(date, startMonth);
  if (startMonth === 1) return String(start.year);
  return `${start.year}-${String((start.year + 1) % 100).padStart(2, "0")}`;
}

export function formatCalendarDate(date: CalendarDate, locale = "en-GB"): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(date.year, date.month - 1, date.day)));
}
