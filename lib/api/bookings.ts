import "server-only";

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { loadSchedule } from "@/lib/availability/context";
import { freeStartTimes } from "@/lib/availability/slots";
import { bookingDayWindow } from "@/lib/bookings/publicUi";
import { createHold } from "@/lib/bookings/hold";
import { submitBooking } from "@/lib/bookings/submit";
import { cancelBooking } from "@/lib/bookings/cancel";
import { notFound } from "@/lib/bookings/errors";
import { paymentState } from "@/lib/bookings/obligation";
import { sendBookingRefunds } from "@/lib/bookings/money/send";
import { upsertMember, removeMember } from "@/lib/members/service";
import type { ApiContext } from "./handler";

/** The `/api/v1` operations (docs/API.md). Every query is scoped to the key's makerspace. */

const bookingInclude = { space: { select: { id: true, slug: true, name: true } }, occurrences: { orderBy: [{ startsAt: "asc" as const }, { unit: "asc" as const }] } } satisfies Prisma.BookingInclude;
type ApiBooking = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

export function bookingJson(booking: ApiBooking, now = new Date()) {
  return {
    id: booking.id, reference: booking.reference, status: booking.status, source: booking.source,
    space: booking.space, quantity: booking.quantity, attendees: booking.attendees, purpose: booking.purpose,
    customer: { name: booking.contactName, email: booking.contactEmail, phone: booking.contactPhone },
    rate: booking.rateKind, chargeMode: booking.chargeMode, currency: booking.currency,
    totalMinor: booking.totalMinor, chargeMinor: booking.chargeMinor, paidMinor: booking.paidMinor, refundedMinor: booking.refundedMinor,
    paymentState: paymentState(booking, now), paymentDueAt: booking.paymentDueAt?.toISOString() ?? null,
    occurrences: booking.occurrences.map((row) => ({ id: row.id, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), unit: row.unit, status: row.status })),
    createdAt: booking.createdAt.toISOString(), confirmedAt: booking.confirmedAt?.toISOString() ?? null, cancelledAt: booking.cancelledAt?.toISOString() ?? null,
  };
}

export async function listSpaces(context: ApiContext) {
  const spaces = await prisma.space.findMany({ where: { makerspaceId: context.makerspaceId, published: true, archivedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  return spaces.map((space) => ({
    id: space.id, slug: space.slug, name: space.name, kind: space.kind, summary: space.summary, capacity: space.capacity, units: space.units, amenities: space.amenities,
    rates: { publicHourlyMinor: space.publicHourlyMinor, publicHalfDayMinor: space.publicHalfDayMinor, publicDayMinor: space.publicDayMinor, memberHourlyMinor: space.memberHourlyMinor, memberHalfDayMinor: space.memberHalfDayMinor, memberDayMinor: space.memberDayMinor },
  }));
}

const availabilityQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"), duration: z.coerce.number().int().min(1).max(10_080), quantity: z.coerce.number().int().min(1).max(500).default(1) });

export async function spaceAvailability(context: ApiContext, spaceId: string, params: URLSearchParams) {
  const query = availabilityQuery.parse(Object.fromEntries(params));
  const makerspace = await prisma.makerspace.findUniqueOrThrow({ where: { id: context.makerspaceId }, select: { timezone: true } });
  const window = bookingDayWindow(query.date, makerspace.timezone);
  const loaded = await loadSchedule(prisma, { makerspaceId: context.makerspaceId, spaceId, from: window.start, to: new Date(window.end.getTime() + query.duration * 60_000) });
  const starts = freeStartTimes(loaded.schedule, { from: window.start.getTime(), to: window.end.getTime(), durationMinutes: query.duration, quantity: query.quantity, now: Date.now() });
  return { date: query.date, timeZone: makerspace.timezone, durationMinutes: query.duration, starts };
}

const listQuery = z.object({
  from: z.coerce.date().optional(), to: z.coerce.date().optional(),
  status: z.enum(["HELD", "REQUESTED", "CONFIRMED", "DECLINED", "EXPIRED", "CANCELLED"]).optional(),
  cursor: z.string().max(64).optional(), limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function listBookings(context: ApiContext, params: URLSearchParams) {
  const query = listQuery.parse(Object.fromEntries(params));
  const rows = await prisma.booking.findMany({
    where: {
      makerspaceId: context.makerspaceId, submittedAt: { not: null }, ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to ? { occurrences: { some: { ...(query.from ? { endsAt: { gt: query.from } } : {}), ...(query.to ? { startsAt: { lt: query.to } } : {}) } } } : {}),
    },
    include: bookingInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, query.limit);
  return { data: page.map((row) => bookingJson(row)), nextCursor: rows.length > query.limit ? page.at(-1)!.id : null };
}

export async function getBooking(context: ApiContext, reference: string) {
  const booking = await prisma.booking.findFirst({ where: { makerspaceId: context.makerspaceId, reference: reference.toUpperCase() }, include: bookingInclude });
  if (!booking) throw notFound();
  return bookingJson(booking);
}

const createBody = z.object({
  spaceId: z.string().min(1).max(64), start: z.coerce.date(), end: z.coerce.date(), quantity: z.number().int().min(1).max(500).default(1),
  attendees: z.number().int().min(1).max(100_000).default(1), purpose: z.string().trim().max(2000).optional(), payLater: z.boolean().optional(),
  customer: z.object({ name: z.string().trim().min(1).max(120), email: z.string().trim().email().max(254), phone: z.string().trim().max(40).nullable().optional() }).strict(),
}).strict().refine((value) => value.end > value.start && value.end.getTime() - value.start.getTime() <= 7 * 86_400_000, { message: "The end must be after the start and within seven days", path: ["end"] });

export async function createBooking(context: ApiContext, body: unknown) {
  const input = createBody.parse(body);
  const held = await createHold({ makerspaceId: context.makerspaceId, spaceId: input.spaceId, actor: context.actor, source: "API", start: input.start, end: input.end, quantity: input.quantity });
  await submitBooking({ makerspaceId: context.makerspaceId, bookingId: held.bookingId, actor: context.actor, contact: input.customer, attendees: input.attendees, purpose: input.purpose, payLater: input.payLater });
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: held.bookingId }, include: bookingInclude });
  return bookingJson(booking);
}

const cancelBody = z.object({ reason: z.string().trim().max(1000).optional() }).strict();

export async function cancelApiBooking(context: ApiContext, reference: string, body: unknown) {
  const input = cancelBody.parse(body);
  const booking = await prisma.booking.findFirst({ where: { makerspaceId: context.makerspaceId, reference: reference.toUpperCase() }, select: { id: true } });
  if (!booking) throw notFound();
  const result = await cancelBooking({ makerspaceId: context.makerspaceId, bookingId: booking.id, actor: context.actor, kind: "STAFF", reason: input.reason });
  await sendBookingRefunds(result.refundIds);
  return getBooking(context, reference);
}

export async function upsertApiMember(context: ApiContext, body: unknown) {
  const member = await upsertMember({ makerspaceId: context.makerspaceId, actor: context.actor, member: body });
  return { id: member.id, email: member.email, name: member.name, validUntil: member.validUntil?.toISOString() ?? null };
}

export async function removeApiMember(context: ApiContext, email: string) {
  const member = await prisma.makerspaceMember.findFirst({ where: { makerspaceId: context.makerspaceId, email: email.trim().toLowerCase() }, select: { id: true } });
  if (!member) throw notFound("Member");
  await removeMember({ makerspaceId: context.makerspaceId, actor: context.actor, memberId: member.id });
}
