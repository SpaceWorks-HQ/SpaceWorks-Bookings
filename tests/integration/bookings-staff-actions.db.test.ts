import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({ userId: null as string | null, ip: "" }));
vi.mock("@/lib/auth", () => ({ auth: async () => identity.userId ? { user: { id: identity.userId } } : null }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": identity.ip }) }));

import { prisma } from "@/lib/db";
import * as staff from "@/app/actions/bookings-staff";
import * as publicActions from "@/app/actions/bookings-public";
import { checkInCode } from "@/lib/bookings/tokens";
import { addSpace, at, bookingOf, contact, eventsOf, rowsOf } from "./bookings-helpers";
import { dataOf, resetActionRequest, setupActionMakerspace, type ActionFixture } from "./booking-actions-helpers";

let fixture: ActionFixture;
let stranger: ActionFixture;
let frontId: string;

async function request(spaceId: string, start: number) {
  identity.userId = fixture.customer.userId;
  const held = dataOf(await publicActions.createHold({ ...fixture.scope, spaceId, start: at(start), end: at(start + 1) }));
  return dataOf(await publicActions.submitBooking({ ...fixture.scope, bookingId: held.bookingId, contact, attendees: 1 }));
}

async function staffBook(spaceId: string, hours: [number, number]) {
  const held = dataOf(await staff.createHold({ ...fixture.scope, spaceId, start: at(hours[0]), end: at(hours[1]) }));
  return dataOf(await staff.submitBooking({ ...fixture.scope, bookingId: held.bookingId, contact, attendees: 1, internalNotes: "Agreed by phone" }));
}

describe.sequential("staff booking Server Actions", () => {
  beforeAll(async () => {
    fixture = await setupActionMakerspace();
    stranger = await setupActionMakerspace();
    frontId = (await fixture.staff("FRONT_DESK")).userId;
  });
  beforeEach(() => { resetActionRequest(identity); identity.userId = fixture.owner.userId; });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
  afterAll(async () => { await fixture.cleanup(); await stranger.cleanup(); });

  it("approves requests, declines with a reason and releases their times", async () => {
    const space = await addSpace(fixture.makerspaceId, { publicHourlyMinor: 0, ruleOverrides: { approvalMode: "APPROVAL" } });
    const first = await request(space.id, 48);
    const second = await request(space.id, 72);
    identity.userId = fixture.owner.userId;
    expect(dataOf(await staff.approveBooking({ ...fixture.scope, bookingId: first.bookingId }))).toMatchObject({ status: "CONFIRMED" });
    expect(await bookingOf(first.bookingId)).toMatchObject({ approvedById: fixture.owner.userId, requestExpiresAt: null });
    expect(await staff.declineBooking({ ...fixture.scope, bookingId: second.bookingId, reason: " " })).toMatchObject({ ok: false });
    expect(dataOf(await staff.declineBooking({ ...fixture.scope, bookingId: second.bookingId, reason: "Hall maintenance" }))).toMatchObject({ status: "DECLINED" });
    expect(await bookingOf(second.bookingId)).toMatchObject({ declineReason: "Hall maintenance", declinedById: fixture.owner.userId, chargeMinor: 0 });
    expect(await rowsOf(second.bookingId)).toEqual([expect.objectContaining({ status: "CANCELLED", blocking: false })]);
    expect(await eventsOf(first.bookingId)).toEqual(["held", "requested", "approved"]);
    expect(await eventsOf(second.bookingId)).toEqual(["held", "requested", "declined"]);
  });

  it("front desk cannot approve or decline requests", async () => {
    const space = await addSpace(fixture.makerspaceId, { ruleOverrides: { approvalMode: "APPROVAL" } });
    const booking = await request(space.id, 48);
    identity.userId = frontId;
    expect(await staff.approveBooking({ ...fixture.scope, bookingId: booking.bookingId })).toEqual({ ok: false, error: "Your role doesn't allow this." });
    expect(await staff.declineBooking({ ...fixture.scope, bookingId: booking.bookingId, reason: "Not permitted" })).toEqual({ ok: false, error: "Your role doesn't allow this." });
    expect((await bookingOf(booking.bookingId)).status).toBe("REQUESTED");
    expect(await eventsOf(booking.bookingId)).toEqual(["held", "requested"]);
  });

  it("front desk books on behalf of a customer, bypassing approval with frozen contact details", async () => {
    const space = await addSpace(fixture.makerspaceId, { publicHourlyMinor: 0, ruleOverrides: { approvalMode: "APPROVAL" } });
    identity.userId = frontId;
    const booking = await staffBook(space.id, [48, 49]);
    expect(booking.status).toBe("CONFIRMED");
    expect(await bookingOf(booking.bookingId)).toMatchObject({ source: "STAFF", customerUserId: null, createdById: frontId,
      contactName: contact.name, contactEmail: contact.email, internalNotes: "Agreed by phone" });
  });

  it("requires bookings.override and a non-empty reason to book despite minimum notice", async () => {
    const space = await addSpace(fixture.makerspaceId, { publicHourlyMinor: 0 });
    const input = { ...fixture.scope, spaceId: space.id, start: at(0.5), end: at(1.5) };
    expect(await staff.createHold(input)).toMatchObject({ ok: false });
    expect(await staff.createHold({ ...input, overrideReason: " " })).toMatchObject({ ok: false });
    identity.userId = frontId;
    expect(await staff.createHold({ ...input, overrideReason: "Walk-in agreed" })).toMatchObject({ ok: false });
    expect(await prisma.booking.count({ where: { spaceId: space.id } })).toBe(0);
    identity.userId = fixture.owner.userId;
    const held = dataOf(await staff.createHold({ ...input, overrideReason: "Walk-in agreed" }));
    const submitted = dataOf(await staff.submitBooking({ ...fixture.scope, bookingId: held.bookingId, contact, attendees: 1 }));
    expect(submitted.status).toBe("CONFIRMED");
    expect((await bookingOf(held.bookingId)).overrideReason).toBe("Walk-in agreed");
    expect(await prisma.bookingEvent.findFirstOrThrow({ where: { bookingId: held.bookingId, kind: "held" } }))
      .toMatchObject({ actorUserId: fixture.owner.userId, data: expect.objectContaining({ overrideReason: "Walk-in agreed", overridden: ["LEAD_TIME"] }) });
  });

  it("front desk checks in by genuine code, refuses a forged code and records a no-show after grace", async () => {
    const space = await addSpace(fixture.makerspaceId, { publicHourlyMinor: 0 });
    identity.userId = frontId;
    const arrival = await staffBook(space.id, [2, 3]);
    const absent = await staffBook(space.id, [5, 6]);
    vi.setSystemTime(at(2));
    expect(await staff.checkInByCode({ ...fixture.scope, code: `${arrival.reference}-00000000` })).toMatchObject({ ok: false });
    dataOf(await staff.checkInByCode({ ...fixture.scope, code: checkInCode(fixture.makerspaceId, arrival.reference) }));
    expect(await rowsOf(arrival.bookingId)).toEqual([expect.objectContaining({ status: "CHECKED_IN", checkedInById: frontId, checkedInAt: at(2) })]);
    const [row] = await rowsOf(absent.bookingId);
    expect(await staff.markNoShow({ ...fixture.scope, occurrenceId: row.id })).toMatchObject({ ok: false });
    vi.setSystemTime(at(5.5));
    dataOf(await staff.markNoShow({ ...fixture.scope, occurrenceId: row.id }));
    expect(await rowsOf(absent.bookingId)).toEqual([expect.objectContaining({ status: "NO_SHOW", noShowAt: at(5.5), noShowById: frontId, blocking: false })]);
    expect(await eventsOf(arrival.bookingId)).toContain("checked-in");
    expect(await eventsOf(absent.bookingId)).toContain("no-show");
  });

  it("returns not found for cross-makerspace booking and occurrence ids", async () => {
    const space = await addSpace(stranger.makerspaceId, { publicHourlyMinor: 0 });
    identity.userId = stranger.owner.userId;
    const held = dataOf(await staff.createHold({ ...stranger.scope, spaceId: space.id, start: at(2), end: at(3) }));
    dataOf(await staff.submitBooking({ ...stranger.scope, bookingId: held.bookingId, contact, attendees: 1 }));
    identity.userId = fixture.owner.userId;
    expect(await staff.approveBooking({ ...fixture.scope, bookingId: held.bookingId })).toEqual({ ok: false, error: "Booking not found." });
    expect(await staff.declineBooking({ ...fixture.scope, bookingId: held.bookingId, reason: "Wrong makerspace" })).toEqual({ ok: false, error: "Booking not found." });
    expect(await staff.cancelBooking({ ...fixture.scope, bookingId: held.bookingId })).toEqual({ ok: false, error: "Booking not found." });
    expect(await staff.checkIn({ ...fixture.scope, occurrenceId: held.occurrences[0].id })).toEqual({ ok: false, error: "Occurrence not found." });
    expect(await staff.markNoShow({ ...fixture.scope, occurrenceId: held.occurrences[0].id })).toEqual({ ok: false, error: "Occurrence not found." });
    expect((await bookingOf(held.bookingId)).status).toBe("CONFIRMED");
  });
});
