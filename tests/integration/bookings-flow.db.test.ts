import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { approveBooking, confirmPaidBooking, declineBooking } from "@/lib/bookings/approval";
import { expireRequests } from "@/lib/bookings/expiry";
import { onBookingConfirmed } from "@/lib/bookings/hooks";
import { findBookingByManageToken } from "@/lib/bookings/links";
import { submitBooking } from "@/lib/bookings/submit";
import { addSpace, at, book, bookingOf, contact, eventsOf, hold, HOUR, NOW, noticesOf, rowsOf, setupMakerspace, type Fixture } from "./bookings-helpers";

let fixture: Fixture;
let gateway: Fixture;

describe.sequential("booking flows", () => {
  beforeAll(async () => {
    fixture = await setupMakerspace();
    gateway = await setupMakerspace({ chargeMode: "PAY_NOW", allowPayLater: true, payLaterMinLeadHours: 48 }, { gateway: true });
  });
  afterAll(async () => {
    await fixture.cleanup();
    await gateway.cleanup();
  });

  it("confirms a free instant booking at once, emails the manage link and fires the hook", async () => {
    const space = await addSpace(fixture.makerspaceId, { publicHourlyMinor: 0, publicHalfDayMinor: null, publicDayMinor: null, memberHourlyMinor: null });
    const seen: string[] = [];
    const off = onBookingConfirmed(async (_tx, booking) => {
      seen.push(booking.id);
    });
    try {
      const { held, submitted } = await book(fixture, space.id, [24, 26]);
      expect(submitted).toMatchObject({ status: "CONFIRMED", totalMinor: 0, chargeMinor: 0, payLater: false, awaitingPayment: false });
      expect(seen).toEqual([held.bookingId]);
      expect(await eventsOf(held.bookingId)).toEqual(["held", "confirmed"]);
      expect(await noticesOf(held.bookingId)).toEqual(["booking-link:confirmed"]);
      // The hold's token stopped working; the emailed one opens the booking.
      expect(await findBookingByManageToken(fixture.makerspaceId, held.manageToken)).toBeNull();
      expect((await findBookingByManageToken(fixture.makerspaceId, submitted.manageToken))?.id).toBe(held.bookingId);
      const booking = await bookingOf(held.bookingId);
      expect(booking.manageTokenHash).not.toContain(submitted.manageToken);
    } finally {
      off();
    }
  });

  it("confirms pay-later bookings with a due date from the rule", async () => {
    const payLater = await setupMakerspace({ chargeMode: "PAY_LATER", payLaterDueRule: "BEFORE_START", payLaterDueHoursBeforeStart: 24 });
    try {
      const space = await addSpace(payLater.makerspaceId);
      const { submitted } = await book(payLater, space.id, [72, 74]);
      expect(submitted).toMatchObject({ status: "CONFIRMED", payLater: true, totalMinor: 100_000, chargeMinor: 100_000 });
      expect(submitted.paymentDueAt).toEqual(at(48));
      expect((await bookingOf(submitted.bookingId)).overdueAction).toBe("NOTIFY_STAFF");
    } finally {
      await payLater.cleanup();
    }
  });

  it("degrades pay now to pay later when no gateway is connected", async () => {
    const offline = await setupMakerspace({ chargeMode: "DEPOSIT", depositKind: "PERCENT", depositPercentBps: 2500 });
    try {
      const space = await addSpace(offline.makerspaceId);
      const { submitted } = await book(offline, space.id, [72, 74]);
      expect(submitted).toMatchObject({ status: "CONFIRMED", payLater: true, degradedToPayLater: true, depositMinor: 25_000 });
    } finally {
      await offline.cleanup();
    }
  });

  it("keeps pay-now bookings held until Phase 2 confirms the payment", async () => {
    const space = await addSpace(gateway.makerspaceId);
    const { submitted } = await book(gateway, space.id, [100, 102]);
    expect(submitted).toMatchObject({ status: "HELD", awaitingPayment: true, payLater: false });
    expect(await noticesOf(submitted.bookingId)).toEqual(["booking-link:received"]);
    const confirmed = await prisma.$transaction((tx) => confirmPaidBooking(tx, { makerspaceId: gateway.makerspaceId, bookingId: submitted.bookingId, now: at(0.1) }));
    expect(confirmed).toMatchObject({ status: "CONFIRMED", awaitingPayment: false });
    expect((await rowsOf(submitted.bookingId)).every((row) => row.blocking)).toBe(true);
    await expect(prisma.$transaction((tx) => confirmPaidBooking(tx, { makerspaceId: fixture.makerspaceId, bookingId: submitted.bookingId }))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lets the booker choose pay later only far enough ahead", async () => {
    const space = await addSpace(gateway.makerspaceId);
    const near = await hold(gateway, space.id, [24, 25]);
    await expect(submitBooking({ makerspaceId: gateway.makerspaceId, bookingId: near.bookingId, actor: gateway.customer, contact, attendees: 1, payLater: true, now: NOW })).rejects.toThrow(/too close to the start/);
    const { submitted } = await book(gateway, space.id, [96, 97], { submit: { payLater: true } });
    expect(submitted).toMatchObject({ status: "CONFIRMED", payLater: true });
  });

  it("prices member rates for a verified account email valid on the date, and staff-typed emails", async () => {
    const space = await addSpace(fixture.makerspaceId);
    await prisma.makerspaceMember.create({ data: { makerspaceId: fixture.makerspaceId, email: fixture.customerUser.email!, name: "Asha", validUntil: new Date("2030-01-08T00:00:00Z") } });
    const valid = await book(fixture, space.id, [10, 12]);
    expect(valid.submitted.totalMinor).toBe(80_000);
    expect((await bookingOf(valid.held.bookingId)).rateKind).toBe("MEMBER");
    // 10 January is after validUntil (8 January, local): public rate.
    const expired = await book(fixture, space.id, [80, 82]);
    expect(expired.submitted.totalMinor).toBe(100_000);
    // An unverified account never gets member rates.
    const stranger = await fixture.person("unverified", false);
    await prisma.makerspaceMember.create({ data: { makerspaceId: fixture.makerspaceId, email: stranger.email! } });
    const unverified = await book(fixture, space.id, [14, 16], { hold: { actor: { kind: "CUSTOMER", userId: stranger.id } }, submit: { contact: { ...contact, email: stranger.email! } } });
    expect(unverified.submitted.totalMinor).toBe(100_000);
    // Staff typing a member's email get member rates; they can also decline them.
    const staffBooked = await book(fixture, space.id, [18, 20], { hold: { actor: fixture.owner, source: "STAFF" }, submit: { contact: { ...contact, email: stranger.email! } } });
    expect(staffBooked.submitted.totalMinor).toBe(80_000);
  });

  it("requests need approval, block the slot, and owe nothing until approved", async () => {
    const approval = await setupMakerspace({ approvalMode: "APPROVAL", chargeMode: "PAY_NOW", requestExpiryHours: 24 }, { gateway: true });
    try {
      const hall = await addSpace(approval.makerspaceId, { name: "Event hall", kind: "HALL" });
      const { submitted } = await book(approval, hall.id, [72, 74]);
      expect(submitted).toMatchObject({ status: "REQUESTED", paymentDueAt: null });
      expect((await rowsOf(submitted.bookingId))[0].blocking).toBe(true);
      expect((await bookingOf(submitted.bookingId)).requestExpiresAt).toEqual(at(24));
      await expect(hold(approval, hall.id, [73, 75])).rejects.toMatchObject({ code: "UNAVAILABLE" });
      const front = await approval.staff("FRONT_DESK");
      await expect(approveBooking({ makerspaceId: approval.makerspaceId, bookingId: submitted.bookingId, actor: front, now: at(1) })).rejects.toMatchObject({ code: "FORBIDDEN" });
      const approved = await approveBooking({ makerspaceId: approval.makerspaceId, bookingId: submitted.bookingId, actor: approval.owner, now: at(1) });
      expect(approved).toMatchObject({ status: "CONFIRMED", overdueAction: "AUTO_CANCEL", payLater: false });
      expect(approved.paymentDueAt).toEqual(at(25));
      expect(await noticesOf(submitted.bookingId)).toEqual(["booking-link:requested", "booking-notice:approved"]);
    } finally {
      await approval.cleanup();
    }
  });

  it("re-checks every rule on approval, unless a manager overrides with a reason", async () => {
    const approval = await setupMakerspace({ approvalMode: "APPROVAL", requestsBlockSlot: false, leadTimeMinutes: 120 });
    try {
      const hall = await addSpace(approval.makerspaceId, { kind: "HALL" });
      const { submitted } = await book(approval, hall.id, [5, 6]);
      expect((await rowsOf(submitted.bookingId))[0].blocking).toBe(false);
      // Someone else took the slot meanwhile (the request didn't block it).
      const other = await book(approval, hall.id, [5, 6], { hold: { actor: approval.owner, source: "STAFF" } });
      expect(other.submitted.status).toBe("CONFIRMED");
      await expect(approveBooking({ makerspaceId: approval.makerspaceId, bookingId: submitted.bookingId, actor: approval.owner, now: at(1) })).rejects.toMatchObject({ code: "UNAVAILABLE" });
      // Lead time has passed by now (start at +5h, lead 2h, now +4h): refused, but overridable.
      const late = await book(approval, hall.id, [8, 9]);
      await expect(approveBooking({ makerspaceId: approval.makerspaceId, bookingId: late.submitted.bookingId, actor: approval.owner, now: at(7) })).rejects.toMatchObject({ code: "UNAVAILABLE", conflicts: [expect.objectContaining({ violations: [expect.objectContaining({ code: "LEAD_TIME" })] })] });
      const overridden = await approveBooking({ makerspaceId: approval.makerspaceId, bookingId: late.submitted.bookingId, actor: approval.owner, overrideReason: "Regular customer, agreed by phone", now: at(7) });
      expect(overridden).toMatchObject({ status: "CONFIRMED", overrideReason: "Regular customer, agreed by phone" });
      expect((await rowsOf(late.submitted.bookingId))[0].blocking).toBe(true);
    } finally {
      await approval.cleanup();
    }
  });

  it("declines with a reason and expires unanswered requests", async () => {
    const approval = await setupMakerspace({ approvalMode: "APPROVAL", requestExpiryHours: 2 });
    try {
      const hall = await addSpace(approval.makerspaceId, { kind: "HALL" });
      const first = await book(approval, hall.id, [48, 50]);
      await expect(declineBooking({ makerspaceId: approval.makerspaceId, bookingId: first.submitted.bookingId, actor: approval.owner, reason: " " })).rejects.toMatchObject({ code: "INVALID_INPUT" });
      const declined = await declineBooking({ makerspaceId: approval.makerspaceId, bookingId: first.submitted.bookingId, actor: approval.owner, reason: "The hall is being painted", now: at(1) });
      expect(declined).toMatchObject({ status: "DECLINED", declineReason: "The hall is being painted", chargeMinor: 0 });
      expect((await rowsOf(first.submitted.bookingId)).every((row) => row.status === "CANCELLED" && !row.blocking)).toBe(true);
      const second = await book(approval, hall.id, [60, 62]);
      expect(await expireRequests(at(1))).toBe(0);
      expect(await expireRequests(at(2) )).toBeGreaterThanOrEqual(1);
      expect(await bookingOf(second.submitted.bookingId)).toMatchObject({ status: "EXPIRED" });
      expect(await noticesOf(second.submitted.bookingId)).toContain("booking-notice:request-expired");
    } finally {
      await approval.cleanup();
    }
  });

  it("lets guests book only where the space allows it", async () => {
    const space = await addSpace(fixture.makerspaceId);
    await expect(hold(fixture, space.id, [30, 31], { actor: { kind: "CUSTOMER", userId: null }, source: "GUEST" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const open = await setupMakerspace({ guestBookingAllowed: true });
    try {
      const room = await addSpace(open.makerspaceId);
      const guest = await hold(open, room.id, [30, 31], { actor: { kind: "CUSTOMER", userId: null }, source: "GUEST" });
      await expect(submitBooking({ makerspaceId: open.makerspaceId, bookingId: guest.bookingId, actor: { kind: "CUSTOMER", userId: null }, contact, attendees: 1, now: NOW })).rejects.toMatchObject({ code: "FORBIDDEN" });
      const done = await submitBooking({ makerspaceId: open.makerspaceId, bookingId: guest.bookingId, actor: { kind: "CUSTOMER", userId: null, manageToken: guest.manageToken }, contact, attendees: 1, now: NOW });
      expect(done.status).toBe("CONFIRMED");
      await expect(submitBooking({ makerspaceId: open.makerspaceId, bookingId: guest.bookingId, actor: { kind: "CUSTOMER", userId: null, manageToken: done.manageToken }, contact, attendees: 1, now: NOW })).rejects.toMatchObject({ code: "HOLD_GONE" });
    } finally {
      await open.cleanup();
    }
  });

  it("refuses to submit an expired hold", async () => {
    const space = await addSpace(fixture.makerspaceId);
    const held = await hold(fixture, space.id, [40, 41]);
    await expect(submitBooking({ makerspaceId: fixture.makerspaceId, bookingId: held.bookingId, actor: fixture.customer, contact, attendees: 1, now: new Date(NOW.getTime() + HOUR) })).rejects.toThrow(/hold has expired/);
  });
});
