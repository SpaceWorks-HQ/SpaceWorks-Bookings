import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import type { CustomerActor } from "@/lib/bookings/actor";
import { isBookingOwner } from "@/lib/bookings/access";
import { findBookingByManageToken } from "@/lib/bookings/links";
import { forbidden, holdGone, invalidInput, notFound } from "@/lib/bookings/errors";
import type { ActionResult } from "@/app/actions/makerspace";
import { bookingFailure, inputFailure, revalidateBookings } from "./bookingContext";

type PublicContext = { makerspaceId: string; actor: CustomerActor; timeZone: string };

export async function publicAction<S extends z.ZodType<{ makerspaceSlug: string }>, T>(
  schema: S, input: unknown, work: (data: z.output<S>, ctx: PublicContext) => Promise<T>,
  options: { active?: boolean; signedIn?: boolean; mutation?: boolean } = {},
): Promise<ActionResult<T>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return inputFailure(parsed.error);
  const data = parsed.data as z.output<S>;
  try {
    if (await isActionRateLimited(options.mutation ? "create" : "action")) throw forbidden("Too many requests. Please try again later.");
    const makerspace = await prisma.makerspace.findUnique({ where: { slug: data.makerspaceSlug }, select: { id: true, status: true, timezone: true } });
    if (!makerspace || (options.active && makerspace.status !== "ACTIVE")) throw notFound("Makerspace");
    const session = await auth();
    const actor: CustomerActor = { kind: "CUSTOMER", userId: session?.user?.id ?? null };
    if (options.signedIn && !actor.userId) throw forbidden("Sign in to manage your bookings.");
    const result = await work(data, { makerspaceId: makerspace.id, actor, timeZone: makerspace.timezone });
    if (options.mutation) revalidateBookings(data.makerspaceSlug);
    return { ok: true, data: result };
  } catch (error) {
    return bookingFailure(error);
  }
}

export async function publishedSpace(makerspaceId: string, spaceId: string) {
  const space = await prisma.space.findFirst({ where: { id: spaceId, makerspaceId, published: true, archivedAt: null } });
  if (!space) throw notFound("Space");
  return space;
}

/** Invalid ownership has the same answer as an unknown or cross-makerspace id. */
export async function customerBooking(makerspaceId: string, actor: CustomerActor, input: { bookingId?: string; manageToken?: string }, hold = false) {
  const resolvedActor: CustomerActor = { ...actor, manageToken: input.manageToken };
  const booking = input.manageToken
    ? await findBookingByManageToken(makerspaceId, input.manageToken)
    : input.bookingId ? await prisma.booking.findFirst({ where: { id: input.bookingId, makerspaceId } }) : null;
  if (!booking || (input.bookingId && booking.id !== input.bookingId) || !isBookingOwner(booking, resolvedActor)) throw hold ? holdGone("Booking not found.") : notFound();
  return { booking, actor: resolvedActor };
}

export async function verifiedMemberEmail(actor: CustomerActor) {
  if (!actor.userId) return null;
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { email: true, emailVerified: true } });
  return user?.emailVerified ? user.email : null;
}

/** Hold credentials may have expired or been rotated by a successful submit. */
export async function customerHold(makerspaceId: string, actor: CustomerActor, input: { bookingId?: string; manageToken?: string }) {
  const owned = await customerBooking(makerspaceId, actor, input, true);
  if (owned.booking.status !== "HELD" || owned.booking.submittedAt || !owned.booking.holdExpiresAt || owned.booking.holdExpiresAt <= new Date()) throw holdGone();
  return owned;
}

/** A preview may ignore only the customer's own checkout hold. */
export async function ownHoldExclusions(makerspaceId: string, actor: CustomerActor, input: { spaceId: string; bookingId?: string; manageToken?: string }) {
  if (!input.bookingId && !input.manageToken) return [];
  const { booking } = await customerHold(makerspaceId, actor, input);
  if (booking.spaceId !== input.spaceId) throw invalidInput("Choose your held booking in this space.");
  return [booking.id];
}
