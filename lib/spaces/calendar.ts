import { z } from "zod";
import { requireStaff, type Actor } from "@/lib/bookings/actor";
import { defaultDb, withTx, type DbOrTx, type Tx } from "@/lib/bookings/db";
import { invalidInput, notFound, zodInputError } from "@/lib/bookings/errors";
import { saveSetting } from "@/lib/settingsAudit";
import { dateKey, fromDbDate, parseDateKey, toDbDate } from "@/lib/time/zoned";

/**
 * Opening hours, dated exceptions and blackouts. Makerspace-wide ones (spaceId null) need `makerspace.settings`;
 * a space's own need `spaces.manage`. A space's weekly hours (and its exceptions) replace the makerspace's as a
 * whole set. Every change is audited.
 */

type Scope = { makerspaceId: string; spaceId: string | null; actor: Actor };
const actorId = (actor: Actor) => (actor.kind === "STAFF" ? actor.userId : null);

async function authorise(tx: Tx, scope: Scope) {
  requireStaff(scope.actor, scope.spaceId ? "spaces.manage" : "makerspace.settings");
  if (scope.spaceId && !(await tx.space.findFirst({ where: { id: scope.spaceId, makerspaceId: scope.makerspaceId }, select: { id: true } }))) throw notFound("Space");
}

const interval = z.object({ openMinute: z.number().int().min(0).max(1439), closeMinute: z.number().int().min(1).max(1440) }).refine((value) => value.openMinute < value.closeMinute, "Closing must be after opening");
const weeklySchema = z.array(interval.and(z.object({ weekday: z.number().int().min(0).max(6) }))).max(7 * 24);

function assertNoOverlap(intervals: Array<{ openMinute: number; closeMinute: number }>, label: string) {
  const sorted = [...intervals].sort((a, b) => a.openMinute - b.openMinute);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].openMinute < sorted[index - 1].closeMinute) throw invalidInput(`${label}: the opening times overlap.`);
  }
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Replace the weekly hours of the makerspace (spaceId null) or of one space. An empty list for a space = inherit. */
export async function replaceOpeningHours(input: Scope & { hours: unknown }, db: DbOrTx = defaultDb()) {
  const parsed = weeklySchema.safeParse(input.hours);
  if (!parsed.success) throw zodInputError(parsed.error.issues);
  for (let weekday = 0; weekday < 7; weekday += 1) assertNoOverlap(parsed.data.filter((row) => row.weekday === weekday), DAY_NAMES[weekday]);
  return withTx(db, async (tx) => {
    await authorise(tx, input);
    const where = { makerspaceId: input.makerspaceId, spaceId: input.spaceId };
    const sortKey = (row: { weekday: number; openMinute: number }) => row.weekday * 10_000 + row.openMinute;
    const before = (await tx.openingHours.findMany({ where })).map(({ weekday, openMinute, closeMinute }) => ({ weekday, openMinute, closeMinute })).sort((a, b) => sortKey(a) - sortKey(b));
    const after = parsed.data.map(({ weekday, openMinute, closeMinute }) => ({ weekday, openMinute, closeMinute })).sort((a, b) => sortKey(a) - sortKey(b));
    await tx.openingHours.deleteMany({ where });
    if (after.length) await tx.openingHours.createMany({ data: after.map((row) => ({ ...row, ...where })) });
    await saveSetting(tx, { area: "opening-hours", makerspaceId: input.makerspaceId, targetType: input.spaceId ? "Space" : "Makerspace", targetId: input.spaceId ?? input.makerspaceId, before: { hours: before }, after: { hours: after }, actorUserId: actorId(input.actor) });
    return after;
  });
}

const exceptionSchema = z.object({
  date: z.string().refine((value) => parseDateKey(value) !== null, "Choose a date"),
  closed: z.boolean(),
  intervals: z.array(interval).max(24).default([]),
  reason: z.string().trim().max(200).default(""),
});

/** Set (create or replace) the exception for one local date. */
export async function setHoursException(input: Scope & { exception: unknown }, db: DbOrTx = defaultDb()) {
  const parsed = exceptionSchema.safeParse(input.exception);
  if (!parsed.success) throw zodInputError(parsed.error.issues);
  const { date, closed, reason } = parsed.data;
  const intervals = closed ? [] : parsed.data.intervals;
  if (!closed && intervals.length === 0) throw invalidInput("Add the special opening hours, or mark the day closed.");
  assertNoOverlap(intervals, date);
  return withTx(db, async (tx) => {
    await authorise(tx, input);
    const existing = await tx.hoursException.findFirst({ where: { makerspaceId: input.makerspaceId, spaceId: input.spaceId, date: toDbDate(parseDateKey(date)!) } });
    const data = { makerspaceId: input.makerspaceId, spaceId: input.spaceId, date: toDbDate(parseDateKey(date)!), closed, intervals, reason };
    const saved = existing ? await tx.hoursException.update({ where: { id: existing.id }, data }) : await tx.hoursException.create({ data });
    const view = (row: { closed: boolean; intervals: unknown; reason: string } | null) => (row ? { date, closed: row.closed, intervals: row.intervals, reason: row.reason } : null);
    await saveSetting(tx, { area: "hours-exception", makerspaceId: input.makerspaceId, targetType: "HoursException", targetId: saved.id, before: view(existing), after: view(saved), actorUserId: actorId(input.actor) });
    return saved;
  });
}

export async function removeHoursException(input: { makerspaceId: string; exceptionId: string; actor: Actor }, db: DbOrTx = defaultDb()) {
  return withTx(db, async (tx) => {
    const row = await tx.hoursException.findFirst({ where: { id: input.exceptionId, makerspaceId: input.makerspaceId } });
    if (!row) throw notFound("Exception");
    await authorise(tx, { makerspaceId: input.makerspaceId, spaceId: row.spaceId, actor: input.actor });
    await tx.hoursException.delete({ where: { id: row.id } });
    await saveSetting(tx, { area: "hours-exception", makerspaceId: input.makerspaceId, targetType: "HoursException", targetId: row.id, before: { date: dateKey(fromDbDate(row.date)), closed: row.closed, intervals: row.intervals, reason: row.reason }, after: null, actorUserId: actorId(input.actor) });
  });
}

const blackoutSchema = z.union([
  z.object({ startDate: z.string().refine((value) => parseDateKey(value) !== null, "Choose a date"), endDate: z.string().refine((value) => parseDateKey(value) !== null, "Choose a date"), reason: z.string().trim().max(200).default("") }),
  z.object({ startsAt: z.coerce.date(), endsAt: z.coerce.date(), reason: z.string().trim().max(200).default("") }),
]);

/** Close whole local days (startDate–endDate, inclusive) or an exact time range. Existing bookings stay. */
export async function createBlackout(input: Scope & { blackout: unknown }, db: DbOrTx = defaultDb()) {
  const parsed = blackoutSchema.safeParse(input.blackout);
  if (!parsed.success) throw zodInputError(parsed.error.issues);
  const value = parsed.data;
  const data =
    "startDate" in value
      ? { startDate: toDbDate(parseDateKey(value.startDate)!), endDate: toDbDate(parseDateKey(value.endDate)!), reason: value.reason }
      : { startsAt: value.startsAt, endsAt: value.endsAt, reason: value.reason };
  if ("startDate" in value ? value.endDate < value.startDate : value.endsAt <= value.startsAt) throw invalidInput("The end must be after the start.");
  return withTx(db, async (tx) => {
    await authorise(tx, input);
    const blackout = await tx.blackout.create({ data: { ...data, makerspaceId: input.makerspaceId, spaceId: input.spaceId } });
    await saveSetting(tx, { area: "blackout", makerspaceId: input.makerspaceId, targetType: "Blackout", targetId: blackout.id, before: null, after: { ...value, spaceId: input.spaceId }, actorUserId: actorId(input.actor) });
    return blackout;
  });
}

export async function removeBlackout(input: { makerspaceId: string; blackoutId: string; actor: Actor }, db: DbOrTx = defaultDb()) {
  return withTx(db, async (tx) => {
    const row = await tx.blackout.findFirst({ where: { id: input.blackoutId, makerspaceId: input.makerspaceId } });
    if (!row) throw notFound("Blackout");
    await authorise(tx, { makerspaceId: input.makerspaceId, spaceId: row.spaceId, actor: input.actor });
    await tx.blackout.delete({ where: { id: row.id } });
    await saveSetting(tx, { area: "blackout", makerspaceId: input.makerspaceId, targetType: "Blackout", targetId: row.id, before: { startDate: row.startDate, endDate: row.endDate, startsAt: row.startsAt, endsAt: row.endsAt, reason: row.reason, spaceId: row.spaceId }, after: null, actorUserId: actorId(input.actor) });
  });
}
