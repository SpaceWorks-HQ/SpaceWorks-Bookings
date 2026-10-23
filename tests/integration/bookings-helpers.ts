import { randomUUID } from "node:crypto";
import type { Prisma, TeamRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { BookingRules } from "@/lib/bookingRules/schema";
import type { CustomerActor, StaffActor } from "@/lib/bookings/actor";
import { createHold, type HoldInput } from "@/lib/bookings/hold";
import { submitBooking, type SubmitInput } from "@/lib/bookings/submit";

/**
 * Shared fixtures for the booking integration suites. Every suite gets its own makerspace (Asia/Kolkata, open all
 * day by default) and fixed clock: NOW is Monday 7 January 2030, 05:30 IST.
 */

export const NOW = new Date("2030-01-07T00:00:00.000Z");
export const HOUR = 3_600_000;
export const at = (hours: number, from = NOW) => new Date(from.getTime() + hours * HOUR);

export type Fixture = Awaited<ReturnType<typeof setupMakerspace>>;

export async function setupMakerspace(rules: Partial<BookingRules> = {}, options: { timezone?: string; gateway?: boolean } = {}) {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
  const makerspace = await prisma.makerspace.create({ data: { name: "Tinkerspace test", slug: `bk-${suffix}`, status: "ACTIVE", timezone: options.timezone ?? "Asia/Kolkata", currency: "INR", stateCode: "KL", contactEmail: "hello@demo.test" } });
  await prisma.makerspaceBookingSettings.create({ data: { makerspaceId: makerspace.id, ...rules } as Prisma.MakerspaceBookingSettingsUncheckedCreateInput });
  if (options.gateway) await prisma.makerspacePaymentSettings.create({ data: { makerspaceId: makerspace.id, provider: "RAZORPAY", webhookPublicCode: `wh-${suffix}` } });
  const users: string[] = [];
  const person = async (label: string, verified = true) => {
    const user = await prisma.user.create({ data: { email: `${label}-${suffix}@example.test`, name: `${label[0].toUpperCase()}${label.slice(1)} Test`, emailVerified: verified ? NOW : null } });
    users.push(user.id);
    return user;
  };
  const staff = async (role: TeamRole): Promise<StaffActor> => {
    const user = await person(role.toLowerCase().replace("_", "-"));
    await prisma.teamMember.create({ data: { userId: user.id, makerspaceId: makerspace.id, role } });
    return { kind: "STAFF", userId: user.id, role };
  };
  const owner = await staff("OWNER");
  const customerUser = await person("customer");
  const customer: CustomerActor = { kind: "CUSTOMER", userId: customerUser.id };
  return {
    suffix,
    makerspace,
    makerspaceId: makerspace.id,
    owner,
    customer,
    customerUser,
    staff,
    person,
    async cleanup() {
      await prisma.$executeRaw`DELETE FROM "OutboxMessage" WHERE "payload"->>'makerspaceId' = ${makerspace.id}`;
      await prisma.makerspace.delete({ where: { id: makerspace.id } }).catch(() => undefined);
      await prisma.auditEvent.deleteMany({ where: { actorUserId: { in: users } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
    },
  };
}

export async function addSpace(makerspaceId: string, over: Partial<Prisma.SpaceUncheckedCreateInput> = {}) {
  const slug = over.slug ?? `space-${randomUUID().slice(0, 8)}`;
  return prisma.space.create({ data: { makerspaceId, name: "Studio A", kind: "ROOM", capacity: 6, units: 1, published: true, publicHourlyMinor: 50_000, publicHalfDayMinor: 160_000, publicDayMinor: 280_000, memberHourlyMinor: 40_000, ...over, slug } });
}

export const contact = { name: "Asha Menon", email: "asha@example.test", phone: "+91 98470 00000" };

export function hold(fixture: Fixture, spaceId: string, hours: [number, number], over: Partial<HoldInput> = {}) {
  return createHold({ makerspaceId: fixture.makerspaceId, spaceId, actor: fixture.customer, source: "PUBLIC", start: at(hours[0]), end: at(hours[1]), now: NOW, ...over });
}

export async function book(fixture: Fixture, spaceId: string, hours: [number, number], over: { hold?: Partial<HoldInput>; submit?: Partial<SubmitInput> } = {}) {
  const held = await hold(fixture, spaceId, hours, over.hold);
  const submitted = await submitBooking({ makerspaceId: fixture.makerspaceId, bookingId: held.bookingId, actor: over.hold?.actor ?? fixture.customer, contact: { ...contact, email: fixture.customerUser.email! }, attendees: 2, now: NOW, ...over.submit });
  return { held, submitted };
}

export async function rowsOf(bookingId: string) {
  return prisma.bookingOccurrence.findMany({ where: { bookingId }, orderBy: [{ slotIndex: "asc" }, { unit: "asc" }] });
}

export async function bookingOf(bookingId: string) {
  return prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
}

export async function eventsOf(bookingId: string) {
  return (await prisma.bookingEvent.findMany({ where: { bookingId }, orderBy: { createdAt: "asc" } })).map((event) => event.kind);
}

export async function noticesOf(bookingId: string) {
  const rows = await prisma.outboxMessage.findMany({ where: { payload: { path: ["bookingId"], equals: bookingId } }, orderBy: { createdAt: "asc" } });
  return rows.map((row) => `${row.kind}:${(row.payload as { notice: string }).notice}`);
}
