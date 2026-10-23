import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({ userId: null as string | null, ip: "" }));
vi.mock("@/lib/auth", () => ({ auth: async () => identity.userId ? { user: { id: identity.userId } } : null }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": identity.ip }) }));

import { prisma } from "@/lib/db";
import * as actions from "@/app/actions/bookings-public";
import { loadBookingAvailability, previewBookingConflicts } from "@/app/actions/booking-availability";
import { updateSpaceRuleOverrides } from "@/app/actions/booking-settings";
import { addSpace, at, bookingOf, contact, eventsOf, noticesOf, rowsOf } from "./bookings-helpers";
import { dataOf, resetActionRequest, setupActionMakerspace, type ActionFixture } from "./booking-actions-helpers";

let fixture: ActionFixture;
let stranger: ActionFixture;

async function publicBook(spaceId: string, start = 48, extra: Record<string, unknown> = {}) {
  const held = dataOf(await actions.createHold({ ...fixture.scope, spaceId, start: at(start), end: at(start + 1) }));
  const submitted = dataOf(await actions.submitBooking({ ...fixture.scope, bookingId: held.bookingId, manageToken: held.manageToken, contact, attendees: 2, ...extra }));
  return { held, submitted };
}

describe.sequential("public booking Server Actions", () => {
  beforeAll(async () => {
    fixture = await setupActionMakerspace({ guestBookingAllowed: true });
    stranger = await setupActionMakerspace({ guestBookingAllowed: true });
  });
  beforeEach(() => resetActionRequest(identity));
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
  afterAll(async () => { await fixture.cleanup(); await stranger.cleanup(); });

  it("releases an owned recurring hold once, frees every unit and permits a replacement", async () => {
    const space = await addSpace(fixture.makerspaceId, { units: 2, publicHourlyMinor: 0 });
    const slot = { ...fixture.scope, spaceId: space.id, start: at(48), end: at(49), quantity: 2, recurrence: { frequency: "DAILY", count: 2 } };
    const held = dataOf(await actions.createHold(slot));
    const owner = { ...fixture.scope, bookingId: held.bookingId, manageToken: held.manageToken };
    expect(await actions.releaseHold({ ...owner, ...stranger.scope })).toMatchObject({ ok: false, code: "HOLD_GONE" });
    expect(await actions.releaseHold({ ...owner, manageToken: "x".repeat(43) })).toMatchObject({ ok: false, code: "HOLD_GONE" });
    expect((await rowsOf(held.bookingId)).every((row) => row.blocking)).toBe(true);
    expect(dataOf(await actions.releaseHold(owner))).toEqual({ released: true });
    expect(dataOf(await actions.releaseHold(owner))).toEqual({ released: false });
    expect(await bookingOf(held.bookingId)).toMatchObject({ status: "EXPIRED", submittedAt: null });
    const rows = await rowsOf(held.bookingId);
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.status === "CANCELLED" && !row.blocking && row.sequence === 1)).toBe(true);
    expect(await eventsOf(held.bookingId)).toEqual(["held", "expired"]);
    expect(await prisma.bookingEvent.findFirst({ where: { bookingId: held.bookingId, kind: "expired" } })).toMatchObject({ actorKind: "CUSTOMER", data: { from: "HELD", reason: "released" } });
    expect(await noticesOf(held.bookingId)).toEqual([]);
    const replacement = dataOf(await actions.createHold(slot));
    expect(replacement.bookingId).not.toBe(held.bookingId);
  });

  it("reports expired and missing holds consistently in every checkout action", async () => {
    const space = await addSpace(fixture.makerspaceId, { publicHourlyMinor: 0 });
    const slot = { ...fixture.scope, spaceId: space.id, start: at(48), end: at(49) };
    const held = dataOf(await actions.createHold(slot));
    vi.setSystemTime(held.holdExpiresAt);
    for (const manageToken of [held.manageToken, "x".repeat(43)]) {
      const owner = { bookingId: held.bookingId, manageToken };
      expect(await actions.submitBooking({ ...fixture.scope, ...owner, contact, attendees: 1 })).toMatchObject({ ok: false, code: "HOLD_GONE" });
      expect(await actions.previewQuote({ ...slot, ...owner })).toMatchObject({ ok: false, code: "HOLD_GONE" });
      expect(await previewBookingConflicts({ ...slot, ...owner })).toMatchObject({ ok: false, code: "HOLD_GONE" });
      expect(await loadBookingAvailability({ ...fixture.scope, spaceId: space.id, date: "2030-01-09", duration: 60, quantity: 1, ...owner })).toMatchObject({ ok: false, code: "HOLD_GONE" });
    }
    expect(dataOf(await actions.createHold(slot)).bookingId).not.toBe(held.bookingId);
    expect((await rowsOf(held.bookingId)).every((row) => !row.blocking)).toBe(true);
  });

  it("does not release or resubmit submitted bookings, including HELD bookings awaiting payment", async () => {
    const paid = await setupActionMakerspace({ guestBookingAllowed: true, chargeMode: "PAY_NOW" }, { gateway: true });
    try {
      for (const publicHourlyMinor of [0, 50_000]) {
        const space = await addSpace(paid.makerspaceId, { publicHourlyMinor });
        const held = dataOf(await actions.createHold({ ...paid.scope, spaceId: space.id, start: at(48), end: at(49) }));
        const owner = { ...paid.scope, bookingId: held.bookingId };
        const submitted = dataOf(await actions.submitBooking({ ...owner, manageToken: held.manageToken, contact, attendees: 1 }));
        expect(submitted.status).toBe(publicHourlyMinor ? "HELD" : "CONFIRMED");
        expect(dataOf(await actions.releaseHold({ ...owner, manageToken: submitted.manageToken }))).toEqual({ released: false });
        for (const manageToken of [held.manageToken, submitted.manageToken]) {
          expect(await actions.submitBooking({ ...owner, manageToken, contact, attendees: 1 })).toMatchObject({ ok: false, code: "HOLD_GONE" });
        }
        expect((await rowsOf(held.bookingId)).every((row) => row.blocking)).toBe(true);
        expect(await eventsOf(held.bookingId)).toEqual(["held", publicHourlyMinor ? "submitted" : "confirmed"]);
      }
    } finally { await paid.cleanup(); }
  });

  it("excludes a verified guest hold from previews without hiding another booking", async () => {
    const space = await addSpace(fixture.makerspaceId, { publicHourlyMinor: 0 });
    const slot = { ...fixture.scope, spaceId: space.id, start: at(48), end: at(49) };
    const held = dataOf(await actions.createHold(slot));
    const owner = { bookingId: held.bookingId, manageToken: held.manageToken };
    expect(dataOf(await previewBookingConflicts(slot)).conflicts).toHaveLength(1);
    expect(dataOf(await previewBookingConflicts({ ...slot, ...owner }))).toMatchObject({ conflicts: [], availableCount: 1 });
    expect(dataOf(await actions.previewQuote({ ...slot, ...owner, skipConflicts: true })).totalMinor).toBe(0);
    const availability = { ...fixture.scope, spaceId: space.id, date: "2030-01-09", duration: 60, quantity: 1 };
    expect(dataOf(await loadBookingAvailability(availability))).not.toContainEqual(expect.objectContaining({ start: at(48).getTime(), end: at(49).getTime() }));
    expect(dataOf(await loadBookingAvailability({ ...availability, ...owner }))).toContainEqual(expect.objectContaining({ start: at(48).getTime(), end: at(49).getTime() }));
    dataOf(await actions.createHold({ ...slot, start: at(50), end: at(51) }));
    expect(dataOf(await previewBookingConflicts({ ...slot, ...owner, start: at(50), end: at(51) })).conflicts).toHaveLength(1);
    expect(await previewBookingConflicts({ ...slot, ...owner, manageToken: "x".repeat(43) })).toEqual({ ok: false, error: "Booking not found.", code: "HOLD_GONE" });
  });

  it("holds then confirms a guest's free instant booking and queues its private link", async () => {
    const space = await addSpace(fixture.makerspaceId, { publicHourlyMinor: 0 });
    const { held, submitted } = await publicBook(space.id);
    expect(submitted).toMatchObject({ status: "CONFIRMED", totalMinor: 0, awaitingPayment: false, payLater: false });
    expect(await bookingOf(held.bookingId)).toMatchObject({ customerUserId: null, contactEmail: contact.email, chargeMinor: 0 });
    expect(await eventsOf(held.bookingId)).toEqual(["held", "confirmed"]);
    expect(await noticesOf(held.bookingId)).toEqual(["booking-link:confirmed"]);
    expect(submitted.manageToken).not.toBe(held.manageToken);
    expect(await actions.cancelByManageToken({ ...fixture.scope, manageToken: held.manageToken })).toEqual({ ok: false, error: "Booking not found." });
  });

  it("submits approval bookings as requests and keeps the occurrence blocking", async () => {
    const space = await addSpace(fixture.makerspaceId, { ruleOverrides: { approvalMode: "APPROVAL" } });
    const { submitted } = await publicBook(space.id);
    expect(submitted).toMatchObject({ status: "REQUESTED", paymentDueAt: null });
    expect(await bookingOf(submitted.bookingId)).toMatchObject({ status: "REQUESTED", requestExpiresAt: at(47) });
    expect(await rowsOf(submitted.bookingId)).toEqual([expect.objectContaining({ blocking: true, status: "SCHEDULED" })]);
    expect(await noticesOf(submitted.bookingId)).toEqual(["booking-link:requested"]);
  });

  it("confirms pay later with the calculated payment due date", async () => {
    const space = await addSpace(fixture.makerspaceId, { ruleOverrides: { chargeMode: "PAY_LATER", payLaterDueHoursBeforeStart: 24 } });
    const { submitted } = await publicBook(space.id, 72);
    expect(submitted).toMatchObject({ status: "CONFIRMED", payLater: true, totalMinor: 50_000, paymentDueAt: at(48) });
    expect(await bookingOf(submitted.bookingId)).toMatchObject({ paymentDueAt: at(48), chargeMinor: 50_000, overdueAction: "NOTIFY_STAFF" });
  });

  it("refuses guests at the hold and rechecks the rule when submitting an existing hold", async () => {
    const closed = await addSpace(fixture.makerspaceId, { ruleOverrides: { guestBookingAllowed: false } });
    expect(await actions.createHold({ ...fixture.scope, spaceId: closed.id, start: at(48), end: at(49) }))
      .toEqual({ ok: false, error: "Sign in to book this space." });
    expect(await prisma.booking.count({ where: { spaceId: closed.id } })).toBe(0);
    const open = await addSpace(fixture.makerspaceId);
    const held = dataOf(await actions.createHold({ ...fixture.scope, spaceId: open.id, start: at(48), end: at(49) }));
    identity.userId = fixture.owner.userId;
    dataOf(await updateSpaceRuleOverrides({ ...fixture.scope, spaceId: open.id, patch: { guestBookingAllowed: false } }));
    identity.userId = null;
    expect(await actions.submitBooking({ ...fixture.scope, bookingId: held.bookingId, manageToken: held.manageToken, contact, attendees: 1 }))
      .toEqual({ ok: false, error: "Sign in to book this space." });
    expect((await bookingOf(held.bookingId)).status).toBe("HELD");
  });

  it("reschedules with the manage token then cancels, updating rows and timeline", async () => {
    const space = await addSpace(fixture.makerspaceId, { publicHourlyMinor: 0 });
    const { submitted } = await publicBook(space.id, 72);
    const [row] = await rowsOf(submitted.bookingId);
    dataOf(await actions.rescheduleByManageToken({ ...fixture.scope, manageToken: submitted.manageToken, occurrenceId: row.id, start: at(96), end: at(97) }));
    expect(await rowsOf(submitted.bookingId)).toEqual([expect.objectContaining({ startsAt: at(96), endsAt: at(97), policyAnchorAt: at(72), sequence: 1 })]);
    dataOf(await actions.cancelByManageToken({ ...fixture.scope, manageToken: submitted.manageToken, reason: "Plans changed" }));
    expect(await bookingOf(submitted.bookingId)).toMatchObject({ status: "CANCELLED", cancelKind: "CUSTOMER", cancelReason: "Plans changed" });
    expect(await rowsOf(submitted.bookingId)).toEqual([expect.objectContaining({ status: "CANCELLED", blocking: false, sequence: 2 })]);
    expect(await eventsOf(submitted.bookingId)).toEqual(["held", "confirmed", "rescheduled", "cancelled"]);
  });

  it("lets the signed-in booking owner cancel, and conceals it from other accounts", async () => {
    identity.userId = fixture.customer.userId;
    const space = await addSpace(fixture.makerspaceId, { publicHourlyMinor: 0 });
    const { submitted } = await publicBook(space.id);
    identity.userId = fixture.owner.userId;
    expect(await actions.cancelBooking({ ...fixture.scope, bookingId: submitted.bookingId })).toEqual({ ok: false, error: "Booking not found." });
    identity.userId = fixture.customer.userId;
    dataOf(await actions.cancelBooking({ ...fixture.scope, bookingId: submitted.bookingId }));
    expect((await bookingOf(submitted.bookingId)).cancelledById).toBe(fixture.customer.userId);
  });

  it("returns not found for cross-makerspace spaces, booking ids, tokens and occurrences", async () => {
    const theirs = await addSpace(stranger.makerspaceId);
    expect(await actions.createHold({ ...fixture.scope, spaceId: theirs.id, start: at(48), end: at(49) })).toEqual({ ok: false, error: "Space not found." });
    const own = await addSpace(fixture.makerspaceId, { publicHourlyMinor: 0 });
    const { submitted } = await publicBook(own.id, 72);
    const [row] = await rowsOf(submitted.bookingId);
    expect(await actions.cancelByManageToken({ ...stranger.scope, manageToken: submitted.manageToken })).toEqual({ ok: false, error: "Booking not found." });
    expect(await actions.rescheduleByManageToken({ ...stranger.scope, manageToken: submitted.manageToken, occurrenceId: row.id, start: at(96), end: at(97) }))
      .toEqual({ ok: false, error: "Booking not found." });
    identity.userId = fixture.customer.userId;
    expect(await actions.cancelBooking({ ...stranger.scope, bookingId: submitted.bookingId })).toEqual({ ok: false, error: "Booking not found." });
    expect((await bookingOf(submitted.bookingId)).status).toBe("CONFIRMED");
  });
});
