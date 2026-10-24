import type { Prisma, PrismaClient, Space } from "@prisma/client";
import { effectiveRules, type EffectiveRules } from "@/lib/bookingRules/effective";
import { pickRules } from "@/lib/bookingRules/schema";
import { openIntervals, blackoutRanges, type BlackoutInput, type HoursExceptionInput, type MinuteInterval, type WeeklyHours } from "@/lib/time/openIntervals";
import { addLocalDays, dateKey, fromDbDate, localParts } from "@/lib/time/zoned";
import { notFound } from "@/lib/bookings/errors";
import type { SpaceSchedule } from "./validate";

/**
 * Loads a space's schedule for a window from the database: effective rules, opening hours (the space's own rows if
 * it has any, else the makerspace's), hour exceptions (same whole-set rule), blackouts (makerspace-wide and the
 * space's) and the blocking occurrences of other bookings. Always scoped by makerspace: a space of another
 * makerspace is not found.
 */

export type Db = Prisma.TransactionClient | PrismaClient;
const DAY = 86_400_000;

export async function loadRules(db: Db, makerspaceId: string, space?: { ruleOverrides: unknown } | null): Promise<EffectiveRules> {
  const settings = await db.makerspaceBookingSettings.findUnique({ where: { makerspaceId } });
  return effectiveRules(pickRules(settings as Record<string, unknown> | null), space);
}

function minuteIntervals(value: Prisma.JsonValue): MinuteInterval[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = item as Record<string, unknown> | null;
    const open = Number(record?.openMinute);
    const close = Number(record?.closeMinute);
    return Number.isInteger(open) && Number.isInteger(close) && open >= 0 && close <= 1440 && open < close ? [{ openMinute: open, closeMinute: close }] : [];
  });
}

/** Hours, exceptions and blackouts that apply to a space (whole-set overrides). */
export async function loadCalendar(db: Db, makerspaceId: string, spaceId: string) {
  const [hours, exceptions, blackouts] = await Promise.all([
    db.openingHours.findMany({ where: { makerspaceId, OR: [{ spaceId }, { spaceId: null }] } }),
    db.hoursException.findMany({ where: { makerspaceId, OR: [{ spaceId }, { spaceId: null }] } }),
    db.blackout.findMany({ where: { makerspaceId, OR: [{ spaceId }, { spaceId: null }] } }),
  ]);
  const ownHours = hours.filter((row) => row.spaceId === spaceId);
  const ownExceptions = exceptions.filter((row) => row.spaceId === spaceId);
  const weekly: WeeklyHours[] = (ownHours.length ? ownHours : hours.filter((row) => row.spaceId === null)).map(({ weekday, openMinute, closeMinute }) => ({ weekday, openMinute, closeMinute }));
  const exceptionInputs: HoursExceptionInput[] = (ownExceptions.length ? ownExceptions : exceptions.filter((row) => row.spaceId === null)).map((row) => ({
    date: dateKey(fromDbDate(row.date)),
    closed: row.closed,
    intervals: minuteIntervals(row.intervals),
  }));
  const blackoutInputs: BlackoutInput[] = blackouts.map((row) =>
    row.startDate && row.endDate
      ? { kind: "DAYS", startDate: dateKey(fromDbDate(row.startDate)), endDate: dateKey(fromDbDate(row.endDate)), reason: row.reason }
      : { kind: "TIMED", startsAt: row.startsAt!, endsAt: row.endsAt!, reason: row.reason },
  );
  return { weekly, exceptions: exceptionInputs, blackouts: blackoutInputs };
}

export type ScheduleQuery = {
  makerspaceId: string;
  spaceId: string;
  from: Date;
  to: Date;
  /** Ignore these bookings' / occurrences' own blocks (approval, reschedule, room move). */
  excludeBookingIds?: string[];
  excludeOccurrenceIds?: string[];
  /** Include archived or unpublished spaces (staff). */
  includeHidden?: boolean;
};

export type LoadedSchedule = { space: Space; timeZone: string; currency: string; rules: EffectiveRules; schedule: SpaceSchedule };

export async function loadSchedule(db: Db, query: ScheduleQuery): Promise<LoadedSchedule> {
  const space = await db.space.findFirst({ where: { id: query.spaceId, makerspaceId: query.makerspaceId } });
  if (!space || (!query.includeHidden && (space.archivedAt || !space.published))) throw notFound("Space");
  const makerspace = await db.makerspace.findUniqueOrThrow({ where: { id: query.makerspaceId }, select: { timezone: true, currency: true } });
  const rules = await loadRules(db, query.makerspaceId, space);
  const calendar = await loadCalendar(db, query.makerspaceId, space.id);
  const values = rules.values;
  const margin = (values.bufferBeforeMinutes + values.bufferAfterMinutes) * 60_000 + DAY;
  const timeZone = makerspace.timezone;
  const open = openIntervals({
    timeZone,
    from: addLocalDays(localParts(query.from.getTime() - margin, timeZone).date, -1),
    to: addLocalDays(localParts(query.to.getTime() + margin, timeZone).date, 1),
    ...calendar,
  });
  const busy = await db.bookingOccurrence.findMany({
    where: {
      spaceId: space.id,
      makerspaceId: query.makerspaceId,
      blocking: true,
      blockStart: { lt: new Date(query.to.getTime() + margin) },
      blockEnd: { gt: new Date(query.from.getTime() - margin) },
      ...(query.excludeBookingIds?.length ? { bookingId: { notIn: query.excludeBookingIds } } : {}),
      ...(query.excludeOccurrenceIds?.length ? { id: { notIn: query.excludeOccurrenceIds } } : {}),
    },
    select: { unit: true, blockStart: true, blockEnd: true },
  });
  return {
    space,
    timeZone,
    currency: makerspace.currency,
    rules,
    schedule: {
      timeZone,
      units: space.units,
      rules: values,
      open,
      blackouts: blackoutRanges(calendar.blackouts, timeZone),
      busy: busy.map((row) => ({ unit: row.unit, start: row.blockStart.getTime(), end: row.blockEnd.getTime() })),
    },
  };
}
