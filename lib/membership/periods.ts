/**
 * Membership period maths. Pure and client-safe. Every boundary is the start of a calendar day in the
 * organisation's timezone, stored as a UTC instant. `endsAt` is exclusive: a term that is "valid until
 * 31 March" ends at 00:00 on 1 April, local time.
 */

export type DurationType = "ROLLING" | "ORG_YEAR" | "FIXED_END" | "LIFETIME";

export type PlanPeriodRules = {
  durationType: DurationType;
  durationMonths?: number | null;
  /** The last valid day of a FIXED_END plan, as a calendar date (its UTC date is used). */
  fixedEndDate?: Date | null;
  graceDays: number;
  renewalWindowDays: number;
  lateRenewalBackdate: boolean;
};

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

function compareDates(a: CalendarDate, b: CalendarDate) {
  return a.year - b.year || a.month - b.month || a.day - b.day;
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

/**
 * The window a term covers when it starts on `startDay`. Returns the start and the exclusive end
 * (null for lifetime). A FIXED_END plan whose end date has already passed cannot start.
 */
export function termWindow(
  plan: PlanPeriodRules,
  startDay: CalendarDate,
  timeZone: string,
  financialYearStartMonth: number,
): { startsAt: Date; endsAt: Date | null } | null {
  const startsAt = startOfLocalDay(startDay, timeZone);
  let endDay: CalendarDate | null;
  switch (plan.durationType) {
    case "ROLLING":
      endDay = addMonths(startDay, Math.max(1, plan.durationMonths ?? 12));
      break;
    case "ORG_YEAR": {
      const fyStart = financialYearStart(startDay, financialYearStartMonth);
      endDay = { year: fyStart.year + 1, month: fyStart.month, day: 1 };
      break;
    }
    case "FIXED_END": {
      if (!plan.fixedEndDate) return null;
      const last = { year: plan.fixedEndDate.getUTCFullYear(), month: plan.fixedEndDate.getUTCMonth() + 1, day: plan.fixedEndDate.getUTCDate() };
      if (compareDates(last, startDay) < 0) return null;
      endDay = addDays(last, 1);
      break;
    }
    case "LIFETIME":
      endDay = null;
      break;
  }
  return { startsAt, endsAt: endDay ? startOfLocalDay(endDay, timeZone) : null };
}

/** End of grace for a term ending at `endsAt`. */
export function graceUntil(endsAt: Date | null, graceDays: number, timeZone: string): Date | null {
  if (!endsAt || graceDays <= 0) return endsAt;
  return startOfLocalDay(addDays(localDate(endsAt, timeZone), graceDays), timeZone);
}

/** The last day a term is valid, for "valid until 31 Mar 2027". */
export function lastValidDay(endsAt: Date, timeZone: string): CalendarDate {
  return localDate(new Date(endsAt.getTime() - 1), timeZone);
}

/** Whether `now` is inside the renewal window before a term ends (or after it, during grace). */
export function canRenewNow(endsAt: Date | null, grace: Date | null, renewalWindowDays: number, now: Date): boolean {
  if (!endsAt) return false;
  const opens = endsAt.getTime() - renewalWindowDays * DAY_MS;
  const closes = (grace ?? endsAt).getTime();
  return now.getTime() >= opens && now.getTime() < closes;
}

/**
 * Where a renewal starts. Paid before the old term ends: at its end (the new term waits as UPCOMING).
 * Paid during grace: at the old end when the plan backdates late renewals, otherwise today.
 * Paid after grace: today, as a fresh start.
 */
export function renewalStartDay(
  previous: { endsAt: Date | null; graceUntil: Date | null },
  plan: Pick<PlanPeriodRules, "lateRenewalBackdate">,
  now: Date,
  timeZone: string,
): CalendarDate {
  const today = localDate(now, timeZone);
  if (!previous.endsAt) return today;
  if (now < previous.endsAt) return localDate(previous.endsAt, timeZone);
  const graceEnd = previous.graceUntil ?? previous.endsAt;
  if (now < graceEnd && plan.lateRenewalBackdate) return localDate(previous.endsAt, timeZone);
  return today;
}

export function formatCalendarDate(date: CalendarDate, locale = "en-GB"): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(date.year, date.month - 1, date.day)));
}
