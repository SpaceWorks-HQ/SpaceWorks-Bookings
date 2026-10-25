/**
 * Local wall time ⇄ UTC in a makerspace's IANA timezone. Pure and client-safe (Intl only).
 *
 * DST: a local time that happens twice (autumn) resolves to the first or the last instant, as asked (openings take
 * the first, closings the last). A local time that never happens (spring gap) is reported as `nonexistent` and
 * resolved with the offset from before the gap, i.e. shifted forward by the gap (01:30 in a 01:00→02:00 gap is
 * 02:30). Callers that need an exact time (a booking start) treat `nonexistent` as a conflict.
 */

export type LocalDate = { year: number; month: number; day: number };
export type Fold = "first" | "last";
export type LocalResolution = { instant: Date; kind: "exact" | "ambiguous" | "nonexistent" };

const MINUTE = 60_000;
const DAY = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(timeZone, format);
  }
  return format;
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function partsOf(ms: number, timeZone: string): Parts {
  const out: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(new Date(ms))) out[part.type] = part.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAYS[out.weekday] ?? 0,
  };
}

/** Minutes the timezone is ahead of UTC at an instant (Asia/Kolkata: 330). */
export function offsetMinutesAt(ms: number, timeZone: string): number {
  const p = partsOf(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MINUTE);
}

/** The local date, minute of the day (0–1439) and weekday (0 = Sunday) of an instant. */
export function localParts(instant: Date | number, timeZone: string): { date: LocalDate; minute: number; weekday: number } {
  const p = partsOf(typeof instant === "number" ? instant : instant.getTime(), timeZone);
  return { date: { year: p.year, month: p.month, day: p.day }, minute: p.hour * 60 + p.minute, weekday: p.weekday };
}

/** Wall-clock milliseconds of a local date and minute, as if the zone were UTC. */
function wallMs(date: LocalDate, minute: number) {
  return Date.UTC(date.year, date.month - 1, date.day) + minute * MINUTE;
}

/** Resolve a local date and minute (0–1440; 1440 = 24:00, the next day's 00:00) to an instant. */
export function resolveLocal(date: LocalDate, minute: number, timeZone: string, fold: Fold = "first"): LocalResolution {
  const wall = wallMs(date, minute);
  const offsets = [...new Set([-DAY, 0, DAY].map((shift) => offsetMinutesAt(wall + shift, timeZone)))];
  const valid = offsets
    .map((offset) => wall - offset * MINUTE)
    .filter((ms) => offsetMinutesAt(ms, timeZone) * MINUTE === wall - ms)
    .sort((a, b) => a - b);
  if (valid.length === 0) return { instant: new Date(wall - Math.min(...offsets) * MINUTE), kind: "nonexistent" };
  const unique = [...new Set(valid)];
  if (unique.length === 1) return { instant: new Date(unique[0]), kind: "exact" };
  return { instant: new Date(fold === "first" ? unique[0] : unique[unique.length - 1]), kind: "ambiguous" };
}

export function localToUtc(date: LocalDate, minute: number, timeZone: string, fold: Fold = "first"): Date {
  return resolveLocal(date, minute, timeZone, fold).instant;
}

/** 00:00 local on a date (the first instant of that local day). */
export function startOfLocalDay(date: LocalDate, timeZone: string): Date {
  return resolveLocal(date, 0, timeZone, "first").instant;
}

// ---------- calendar dates ----------

export function addLocalDays(date: LocalDate, days: number): LocalDate {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * DAY);
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

export function weekdayOf(date: LocalDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day);
}

/** Whole days from a to b. */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round(compareDates(b, a) / DAY);
}

export function dateKey(date: LocalDate): string {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

export function parseDateKey(value: string): LocalDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  return dateKey(addLocalDays(date, 0)) === value ? date : null;
}

/** A Postgres DATE column (read by Prisma as UTC midnight) as a local date, and back. */
export function fromDbDate(value: Date): LocalDate {
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

export function toDbDate(date: LocalDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

export function isValidTimeZoneName(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
