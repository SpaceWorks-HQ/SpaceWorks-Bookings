import { defaultDb, lockBooking, withTx, type DbOrTx } from "./db";
import { recordBookingEvent } from "./events";
import { enqueueBookingNotice } from "./notify";
import { hashToken, newManageToken, REFERENCE_PATTERN } from "./tokens";
import { SYSTEM } from "./actor";

/**
 * Manage links. The page lives at `manageBookingPath` (Phase 1b builds the route); the token is the only key, so
 * it is never logged or stored in clear. Losing it is fixed by `requestManageLink`, which rotates the token and
 * emails a new link without saying whether the booking exists.
 */

export function manageBookingPath(makerspaceSlug: string, token: string): string {
  return `/m/${makerspaceSlug}/booking/${encodeURIComponent(token)}`;
}

/** The booking a manage token opens, within one makerspace. */
export async function findBookingByManageToken(makerspaceId: string, token: string, db: DbOrTx = defaultDb()) {
  if (!token || token.length > 128) return null;
  return db.booking.findFirst({ where: { makerspaceId, manageTokenHash: hashToken(token) } });
}

/** Email a fresh manage link when the reference and email match; silently do nothing otherwise. */
export async function requestManageLink(input: { makerspaceId: string; reference: string; email: string }, db: DbOrTx = defaultDb()): Promise<void> {
  const reference = input.reference.trim().toUpperCase();
  if (!REFERENCE_PATTERN.test(reference)) return;
  const found = await db.booking.findFirst({ where: { makerspaceId: input.makerspaceId, reference, contactEmail: input.email.trim().toLowerCase() }, select: { id: true } });
  if (!found) return;
  await withTx(db, async (tx) => {
    const booking = await lockBooking(tx, input.makerspaceId, found.id);
    const token = newManageToken();
    await tx.booking.update({ where: { id: booking.id }, data: { manageTokenHash: token.hash } });
    await recordBookingEvent(tx, { makerspaceId: input.makerspaceId, bookingId: booking.id, kind: "manage-link-sent", actor: SYSTEM });
    await enqueueBookingNotice(tx, { makerspaceId: input.makerspaceId, bookingId: booking.id, notice: "manage-link", manageToken: token.token });
  });
}
