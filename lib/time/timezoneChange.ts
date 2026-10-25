import { requireStaff, type Actor } from "@/lib/bookings/actor";
import { defaultDb, withTx, type DbOrTx } from "@/lib/bookings/db";
import { invalidInput, invalidState } from "@/lib/bookings/errors";
import { saveSetting } from "@/lib/settingsAudit";
import { isValidTimeZoneName } from "./zoned";

/**
 * A makerspace's timezone decides what every stored local rule means (hours, blackouts, peak windows, member dates),
 * so it can't change while bookings are still to come: their local times would silently move.
 */

export async function countFutureBookings(makerspaceId: string, now = new Date(), db: DbOrTx = defaultDb()): Promise<number> {
  return db.booking.count({ where: { makerspaceId, status: { in: ["HELD", "REQUESTED", "CONFIRMED"] }, occurrences: { some: { endsAt: { gt: now }, status: { in: ["SCHEDULED", "CHECKED_IN"] } } } } });
}

/** Throws when the timezone can't change now; the message is safe to show. */
export async function assertTimezoneChangeAllowed(makerspaceId: string, now = new Date(), db: DbOrTx = defaultDb()): Promise<void> {
  const future = await countFutureBookings(makerspaceId, now, db);
  if (future > 0) throw invalidState(`The timezone can't change while ${future} ${future === 1 ? "booking is" : "bookings are"} still to come.`);
}

export async function changeMakerspaceTimezone(input: { makerspaceId: string; actor: Actor; timezone: string; now?: Date }, db: DbOrTx = defaultDb()): Promise<void> {
  requireStaff(input.actor, "makerspace.settings");
  if (!isValidTimeZoneName(input.timezone)) throw invalidInput("Choose a timezone.", { timezone: "Unknown timezone" });
  await withTx(db, async (tx) => {
    const before = await tx.makerspace.findUniqueOrThrow({ where: { id: input.makerspaceId }, select: { timezone: true } });
    if (before.timezone === input.timezone) return;
    await assertTimezoneChangeAllowed(input.makerspaceId, input.now, tx);
    await tx.makerspace.update({ where: { id: input.makerspaceId }, data: { timezone: input.timezone } });
    await saveSetting(tx, { area: "timezone", makerspaceId: input.makerspaceId, targetType: "Makerspace", targetId: input.makerspaceId, before, after: { timezone: input.timezone }, actorUserId: input.actor.kind === "STAFF" ? input.actor.userId : null });
  });
}
