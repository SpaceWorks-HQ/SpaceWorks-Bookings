import { Prisma } from "@prisma/client";
import { SYSTEM, type CustomerActor } from "./actor";
import { assertCanActOn } from "./access";
import { defaultDb, lockBooking, withTx, type DbOrTx, type Tx } from "./db";
import { recordBookingEvent } from "./events";
import { enqueueBookingNotice } from "./notify";
import { recomputeCharge } from "./charge";
import { setBookingStatus } from "./status";

/**
 * Expiry of checkout holds and unanswered requests. Rows are claimed with FOR UPDATE SKIP LOCKED, so a booking
 * someone is working on is left for the next sweep, and the status is re-checked under the lock.
 */

const BATCH = 200;

/** Abandon checkout, without touching a submitted booking (including one awaiting payment). */
export async function releaseHold(input: { makerspaceId: string; bookingId: string; actor: CustomerActor }, db: DbOrTx = defaultDb()) {
  return withTx(db, async (tx) => {
    const booking = await lockBooking(tx, input.makerspaceId, input.bookingId);
    assertCanActOn(booking, input.actor, "bookings.manage");
    if (booking.status !== "HELD" || booking.submittedAt) return { released: false };
    const now = new Date();
    await setBookingStatus(tx, booking, "EXPIRED", { requestsBlockSlot: false, now, data: { expiredAt: now }, cancelKind: "CUSTOMER" });
    await recomputeCharge(tx, booking.id);
    await recordBookingEvent(tx, { ...input, kind: "expired", data: { from: "HELD", reason: "released" } });
    return { released: true };
  });
}

async function claim(tx: Tx, status: "HELD" | "REQUESTED", now: Date, spaceId?: string) {
  const column = status === "HELD" ? Prisma.sql`"holdExpiresAt"` : Prisma.sql`"requestExpiresAt"`;
  const scope = spaceId ? Prisma.sql`AND "spaceId" = ${spaceId}` : Prisma.empty;
  return tx.$queryRaw<Array<{ id: string; makerspaceId: string }>>`
    SELECT "id", "makerspaceId" FROM "Booking"
    WHERE "status" = ${status}::"BookingStatus" AND ${column} <= ${now} ${scope}
    ORDER BY ${column} ASC LIMIT ${BATCH}
    FOR UPDATE SKIP LOCKED`;
}

async function expireOne(tx: Tx, row: { id: string; makerspaceId: string }, from: "HELD" | "REQUESTED", now: Date) {
  const booking = await tx.booking.findUniqueOrThrow({ where: { id: row.id }, select: { id: true, status: true } });
  if (booking.status !== from) return false;
  await setBookingStatus(tx, booking, "EXPIRED", { requestsBlockSlot: false, now, data: { expiredAt: now }, cancelKind: "SYSTEM" });
  await recomputeCharge(tx, row.id);
  await recordBookingEvent(tx, { makerspaceId: row.makerspaceId, bookingId: row.id, kind: "expired", actor: SYSTEM, data: { from } });
  if (from === "REQUESTED") await enqueueBookingNotice(tx, { makerspaceId: row.makerspaceId, bookingId: row.id, notice: "request-expired" });
  return true;
}

/** Inside a hold: release this space's expired holds before allocating units. */
export async function releaseExpiredHoldsForSpace(tx: Tx, spaceId: string, now: Date): Promise<number> {
  let released = 0;
  for (const row of await claim(tx, "HELD", now, spaceId)) if (await expireOne(tx, row, "HELD", now)) released += 1;
  return released;
}

/** Beat job: expire checkout holds whose time ran out. */
export async function expireHolds(now = new Date(), db: DbOrTx = defaultDb()): Promise<number> {
  return withTx(db, async (tx) => {
    let expired = 0;
    for (const row of await claim(tx, "HELD", now)) if (await expireOne(tx, row, "HELD", now)) expired += 1;
    return expired;
  });
}

/** Beat job: expire requests nobody answered (requestExpiresAt is also capped at the start minus the lead time). */
export async function expireRequests(now = new Date(), db: DbOrTx = defaultDb()): Promise<number> {
  return withTx(db, async (tx) => {
    let expired = 0;
    for (const row of await claim(tx, "REQUESTED", now)) if (await expireOne(tx, row, "REQUESTED", now)) expired += 1;
    return expired;
  });
}
