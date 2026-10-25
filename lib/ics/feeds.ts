import { randomBytes } from "node:crypto";
import type { CalendarFeedKind } from "@prisma/client";
import { requireStaff, type Actor } from "@/lib/bookings/actor";
import { defaultDb, type DbOrTx } from "@/lib/bookings/db";
import { forbidden } from "@/lib/bookings/errors";
import { hashToken } from "@/lib/bookings/tokens";
import { can } from "@/lib/permissionRoles";
import { bookingEvent } from "./booking";
import { buildIcs } from "./format";

/**
 * Private ICS subscriptions. A CUSTOMER feed lists the customer's own bookings at one makerspace; a STAFF feed lists
 * every live booking of the makerspace without customer details. The URL carries a 32-byte token; only its hash is
 * stored. Creating a feed again rotates the token; revoking stops it. Routes come in Phase 1b.
 */

const FEED_LIMIT = 1000;
const DAY = 86_400_000;

export async function issueCalendarFeed(input: { makerspaceId: string; kind: CalendarFeedKind; actor: Actor }, db: DbOrTx = defaultDb()): Promise<{ token: string; hint: string }> {
  let userId: string;
  if (input.kind === "STAFF") userId = requireStaff(input.actor, "bookings.view").userId;
  else if (input.actor.kind === "CUSTOMER" && input.actor.userId) userId = input.actor.userId;
  else throw forbidden("Sign in to subscribe to your bookings.");
  const token = randomBytes(32).toString("base64url");
  const hint = token.slice(-6);
  const key = { makerspaceId_userId_kind: { makerspaceId: input.makerspaceId, userId, kind: input.kind } };
  await db.calendarFeed.upsert({
    where: key,
    create: { makerspaceId: input.makerspaceId, userId, kind: input.kind, tokenHash: hashToken(token), tokenHint: hint },
    update: { tokenHash: hashToken(token), tokenHint: hint, rotatedAt: new Date(), revokedAt: null },
  });
  return { token, hint };
}

export async function revokeCalendarFeed(input: { makerspaceId: string; kind: CalendarFeedKind; userId: string }, db: DbOrTx = defaultDb()): Promise<void> {
  await db.calendarFeed.updateMany({ where: { makerspaceId: input.makerspaceId, userId: input.userId, kind: input.kind, revokedAt: null }, data: { revokedAt: new Date() } });
}

/** The feed body for a token, or null (unknown, revoked, or staff no longer on the team). */
export async function renderCalendarFeed(token: string, now = new Date(), db: DbOrTx = defaultDb()): Promise<string | null> {
  if (!token || token.length > 128) return null;
  const feed = await db.calendarFeed.findUnique({ where: { tokenHash: hashToken(token) }, include: { makerspace: { select: { name: true, contactEmail: true, addressLine: true, city: true } } } });
  if (!feed || feed.revokedAt) return null;
  if (feed.kind === "STAFF") {
    const member = await db.teamMember.findUnique({ where: { userId_makerspaceId: { userId: feed.userId, makerspaceId: feed.makerspaceId } }, select: { role: true } });
    if (!member || !can(member.role, "bookings.view")) return null;
  }
  const staff = feed.kind === "STAFF";
  const occurrences = await db.bookingOccurrence.findMany({
    where: {
      makerspaceId: feed.makerspaceId,
      endsAt: { gt: new Date(now.getTime() - 30 * DAY) },
      booking: staff ? { status: { in: ["CONFIRMED", "REQUESTED"] } } : { customerUserId: feed.userId, status: { in: ["CONFIRMED", "REQUESTED", "CANCELLED"] } },
      ...(staff ? { status: { not: "CANCELLED" } } : {}),
    },
    include: { booking: { select: { reference: true, status: true, contactName: true, contactEmail: true } }, space: { select: { name: true } } },
    orderBy: { startsAt: "asc" },
    take: FEED_LIMIT * 4,
  });
  const makerspace = { name: feed.makerspace.name, contactEmail: feed.makerspace.contactEmail, address: [feed.makerspace.addressLine, feed.makerspace.city].filter(Boolean).join(", ") || null };
  const firstOfSlot = new Map<string, (typeof occurrences)[number]>();
  for (const row of [...occurrences].sort((a, b) => a.unit - b.unit)) {
    const key = `${row.bookingId}:${row.slotIndex}`;
    if (!firstOfSlot.has(key)) firstOfSlot.set(key, row);
  }
  const events = [...firstOfSlot.values()]
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, FEED_LIMIT)
    .map((row) => {
      const event = bookingEvent({ booking: row.booking, spaceName: row.space.name, makerspace, now }, row, !staff);
      return staff ? { ...event, summary: `${row.space.name}: ${row.booking.reference}`, organizer: null } : event;
    });
  return buildIcs({ method: "PUBLISH", name: staff ? `${feed.makerspace.name} bookings` : `My bookings at ${feed.makerspace.name}`, events });
}
