import { loadRules } from "@/lib/availability/context";
import type { BookingRules } from "@/lib/bookingRules/schema";
import { SYSTEM } from "./actor";
import { markNoShow } from "./checkin";
import { recomputeCharge } from "./charge";
import { defaultDb, withTx, type DbOrTx } from "./db";
import { BookingError } from "./errors";
import { recordBookingEvent } from "./events";
import { enqueueBookingNotice } from "./notify";

/**
 * Periodic booking work, registered in lib/scheduled/index.ts. Each job is idempotent and safe to run on several
 * workers at once (row locks, status-guarded updates, ReminderLog's unique key).
 */

const HOUR = 3_600_000;
const BATCH = 500;

async function rulesBySpace(db: DbOrTx, rows: Array<{ makerspaceId: string; spaceId: string }>) {
  const cache = new Map<string, BookingRules>();
  for (const row of rows) {
    if (cache.has(row.spaceId)) continue;
    const space = await db.space.findFirst({ where: { id: row.spaceId, makerspaceId: row.makerspaceId } });
    cache.set(row.spaceId, (await loadRules(db, row.makerspaceId, space)).values);
  }
  return cache;
}

/** Occurrences whose block has ended: checked in or scheduled → COMPLETED; a held-over no-show → NO_SHOW. */
export async function completeOccurrences(now = new Date(), db: DbOrTx = defaultDb()): Promise<number> {
  const due = await db.bookingOccurrence.findMany({
    where: { status: { in: ["SCHEDULED", "CHECKED_IN"] }, blockEnd: { lte: now }, booking: { status: "CONFIRMED" } },
    select: { id: true, bookingId: true, makerspaceId: true, status: true, noShowAt: true },
    take: BATCH,
  });
  const bookings = [...new Set(due.map((row) => row.bookingId))];
  for (const bookingId of bookings) {
    const rows = due.filter((row) => row.bookingId === bookingId);
    await withTx(db, async (tx) => {
      const noShows = rows.filter((row) => row.status === "SCHEDULED" && row.noShowAt).map((row) => row.id);
      const completed = rows.filter((row) => !noShows.includes(row.id)).map((row) => row.id);
      const done = await tx.bookingOccurrence.updateMany({ where: { id: { in: completed }, status: { in: ["SCHEDULED", "CHECKED_IN"] } }, data: { status: "COMPLETED", blocking: false, completedAt: now } });
      const missed = await tx.bookingOccurrence.updateMany({ where: { id: { in: noShows }, status: "SCHEDULED" }, data: { status: "NO_SHOW", blocking: false } });
      if (done.count + missed.count === 0) return;
      await recomputeCharge(tx, bookingId);
      await recordBookingEvent(tx, { makerspaceId: rows[0].makerspaceId, bookingId, kind: "completed", actor: SYSTEM, data: { completed: done.count, noShows: missed.count } });
    });
  }
  return due.length;
}

/** Spaces with auto no-show: scheduled, not checked in, past start + grace. */
export async function autoMarkNoShows(now = new Date(), db: DbOrTx = defaultDb()): Promise<number> {
  const candidates = await db.bookingOccurrence.findMany({
    where: { status: "SCHEDULED", noShowAt: null, startsAt: { lte: now, gt: new Date(now.getTime() - 48 * HOUR) }, endsAt: { gt: now }, booking: { status: "CONFIRMED" } },
    select: { id: true, makerspaceId: true, spaceId: true, bookingId: true, slotIndex: true, startsAt: true },
    orderBy: [{ bookingId: "asc" }, { slotIndex: "asc" }, { unit: "asc" }],
    take: BATCH,
  });
  const rules = await rulesBySpace(db, candidates);
  const seen = new Set<string>();
  let marked = 0;
  for (const row of candidates) {
    const slot = `${row.bookingId}:${row.slotIndex}`;
    const rule = rules.get(row.spaceId);
    if (seen.has(slot) || !rule?.autoNoShow || now.getTime() < row.startsAt.getTime() + rule.noShowGraceMinutes * 60_000) continue;
    seen.add(slot);
    try {
      await markNoShow({ makerspaceId: row.makerspaceId, occurrenceId: row.id, actor: SYSTEM, now }, db);
      marked += 1;
    } catch (error) {
      if (!(error instanceof BookingError)) throw error;
    }
  }
  return marked;
}

/**
 * Reminders `reminderHoursBefore` each slot (one email per slot, not per unit). Only reminders whose moment has
 * come and that the booking existed for are sent; if several are due at once only the nearest is emailed. A
 * reschedule (new start) may remind again.
 */
export async function sendBookingReminders(now = new Date(), db: DbOrTx = defaultDb()): Promise<number> {
  const upcoming = await db.bookingOccurrence.findMany({
    where: { status: "SCHEDULED", startsAt: { gt: now, lte: new Date(now.getTime() + 168 * HOUR) }, booking: { status: "CONFIRMED" } },
    select: { id: true, makerspaceId: true, spaceId: true, bookingId: true, slotIndex: true, startsAt: true, booking: { select: { confirmedAt: true } } },
    orderBy: [{ startsAt: "asc" }, { bookingId: "asc" }, { unit: "asc" }],
    take: BATCH,
  });
  const rules = await rulesBySpace(db, upcoming);
  const seen = new Set<string>();
  let sent = 0;
  for (const row of upcoming) {
    const slot = `${row.bookingId}:${row.slotIndex}`;
    if (seen.has(slot)) continue;
    seen.add(slot);
    const confirmedAt = row.booking.confirmedAt?.getTime() ?? now.getTime();
    const due = (rules.get(row.spaceId)?.reminderHoursBefore ?? []).filter((hours) => {
      const moment = row.startsAt.getTime() - hours * HOUR;
      return moment <= now.getTime() && confirmedAt <= moment;
    });
    if (due.length === 0) continue;
    const created = await withTx(db, async (tx) => {
      const logged = await tx.reminderLog.createMany({ data: due.map((hours) => ({ makerspaceId: row.makerspaceId, occurrenceId: row.id, kind: `reminder-${hours}h`, startsAt: row.startsAt })), skipDuplicates: true });
      if (logged.count === 0) return false;
      await enqueueBookingNotice(tx, { makerspaceId: row.makerspaceId, bookingId: row.bookingId, notice: "reminder", occurrenceIds: [row.id] });
      return true;
    });
    if (created) sent += 1;
  }
  return sent;
}
