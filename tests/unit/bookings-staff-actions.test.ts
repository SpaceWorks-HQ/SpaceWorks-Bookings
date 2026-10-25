import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), revalidate: vi.fn(), hold: vi.fn(), submit: vi.fn(), approve: vi.fn(), decline: vi.fn(), cancel: vi.fn(), reschedule: vi.fn(), move: vi.fn(), occurrence: vi.fn(), checkIn: vi.fn(), noShow: vi.fn(), issue: vi.fn(), revoke: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ makerspaceActionAccess: mocks.access }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/db", () => ({ prisma: { bookingOccurrence: { findFirst: mocks.occurrence } } }));
vi.mock("@/lib/bookings/hold", () => ({ createHold: mocks.hold }));
vi.mock("@/lib/bookings/submit", () => ({ submitBooking: mocks.submit }));
vi.mock("@/lib/bookings/approval", () => ({ approveBooking: mocks.approve, declineBooking: mocks.decline }));
vi.mock("@/lib/bookings/cancel", () => ({ cancelBooking: mocks.cancel }));
vi.mock("@/lib/bookings/reschedule", () => ({ rescheduleOccurrence: mocks.reschedule }));
vi.mock("@/lib/bookings/move", () => ({ moveBooking: mocks.move }));
vi.mock("@/lib/bookings/checkin", () => ({ checkIn: mocks.checkIn, markNoShow: mocks.noShow }));
vi.mock("@/lib/ics/feeds", () => ({ issueCalendarFeed: mocks.issue, revokeCalendarFeed: mocks.revoke }));
import * as actions from "@/app/actions/bookings-staff";
import { BookingError } from "@/lib/bookings/errors";
import { checkInCode } from "@/lib/bookings/tokens";
const slug = { makerspaceSlug: "tinkerspace" };
const booking = { ...slug, bookingId: "booking" };
const slot = { start: "2026-11-01T09:00:00Z", end: "2026-11-01T10:00:00Z" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({ ok: true, makerspace: { id: "tenant" }, userId: "staff", membership: { role: "FRONT_DESK" } });
  mocks.approve.mockResolvedValue({ id: "booking", status: "CONFIRMED" });
  mocks.decline.mockResolvedValue({ id: "booking", status: "DECLINED" }); mocks.move.mockResolvedValue({ id: "booking", spaceId: "room2" });
  mocks.occurrence.mockResolvedValue({ id: "o" });
});

describe("staff booking actions", () => {
  it.each([
    ["createHold", { ...slug, ...slot, spaceId: "room" }, "bookings.manage", "hold"],
    ["submitBooking", { ...booking, contact: { name: "Customer", email: "customer@example.test" }, attendees: 1 }, "bookings.manage", "submit"],
    ["approveBooking", booking, "bookings.approve", "approve"],
    ["declineBooking", { ...booking, reason: "Repairs" }, "bookings.approve", "decline"],
    ["cancelBooking", booking, "bookings.manage", "cancel"],
    ["rescheduleOccurrence", { ...booking, ...slot, occurrenceId: "o" }, "bookings.manage", "reschedule"],
    ["moveBooking", { ...booking, toSpaceId: "room2" }, "bookings.manage", "move"],
    ["checkIn", booking, "bookings.manage", "checkIn"],
    ["markNoShow", { ...slug, occurrenceId: "o" }, "bookings.manage", "noShow"],
    ["issueStaffCalendarFeed", slug, "bookings.view", "issue"],
    ["revokeStaffCalendarFeed", slug, "bookings.view", "revoke"],
  ] as const)("gates %s and passes the resolved staff actor", async (name, input, capability, mock) => {
    expect(await actions[name](input)).toMatchObject({ ok: true });
    expect(mocks.access).toHaveBeenCalledWith("tinkerspace", capability);
    expect(mocks[mock]).toHaveBeenCalledWith(expect.objectContaining({ makerspaceId: "tenant", ...(mock === "revoke" ? { userId: "staff", kind: "STAFF" } : { actor: { kind: "STAFF", userId: "staff", role: "FRONT_DESK" } }) }));
  });
  it("front desk cancels for the customer with policy, and cannot cancel for the venue", async () => {
    await actions.cancelBooking(booking);
    expect(mocks.cancel).toHaveBeenCalledWith(expect.objectContaining({ kind: "STAFF" })); mocks.cancel.mockClear();
    expect(await actions.cancelBooking({ ...booking, kind: "VENUE", reason: "Repairs" })).toMatchObject({ ok: false });
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it("requires an override capability and non-blank reason for rule overrides", async () => {
    expect(await actions.createHold({ ...slug, ...slot, spaceId: "room", overrideReason: "Manager agreed" })).toMatchObject({ ok: false });
    expect(await actions.createHold({ ...slug, ...slot, spaceId: "room", overrideReason: " " })).toMatchObject({ ok: false, fieldErrors: { overrideReason: expect.any(Array) } });
    expect(mocks.hold).not.toHaveBeenCalled();
    mocks.access.mockResolvedValue({ ok: true, makerspace: { id: "tenant" }, userId: "manager", membership: { role: "BOOKINGS_MANAGER" } });
    expect(await actions.createHold({ ...slug, ...slot, spaceId: "room", overrideReason: "Manager agreed" })).toMatchObject({ ok: true });
    expect(mocks.hold).toHaveBeenCalledWith(expect.objectContaining({ overrideReason: "Manager agreed", source: "STAFF" }));
  });
  it("does not write when access, including MFA and makerspace status, is refused", async () => {
    mocks.access.mockResolvedValue({ ok: false, error: "Makerspace not found." });
    expect(await actions.cancelBooking(booking)).toEqual({ ok: false, error: "Makerspace not found." });
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it("scopes a check-in by both booking and occurrence ids", async () => {
    await actions.checkIn({ ...booking, occurrenceId: "o" });
    expect(mocks.occurrence).toHaveBeenCalledWith(expect.objectContaining({ where: { makerspaceId: "tenant", id: "o", bookingId: "booking" } }));
    mocks.occurrence.mockResolvedValue(null); mocks.checkIn.mockClear();
    expect(await actions.checkIn({ ...booking, occurrenceId: "foreign" })).toEqual({ ok: false, error: "Occurrence not found." });
    expect(mocks.checkIn).not.toHaveBeenCalled();
  });
  it("verifies the separate check-in HMAC against the current makerspace", async () => {
    const code = checkInCode("tenant", "BK-123456");
    expect(await actions.checkInByCode({ ...slug, code })).toMatchObject({ ok: true });
    expect(mocks.checkIn).toHaveBeenCalledWith(expect.objectContaining({ code })); mocks.checkIn.mockClear();
    expect(await actions.checkInByCode({ ...slug, code: checkInCode("foreign", "BK-123456") })).toMatchObject({ ok: false });
    expect(mocks.checkIn).not.toHaveBeenCalled();
  });
  it("maps domain field errors and slot conflicts to safe copy", async () => {
    mocks.cancel.mockRejectedValue(new BookingError("INVALID_INPUT", "Check the highlighted fields.", [], { reason: "Required" }));
    expect(await actions.cancelBooking(booking)).toEqual({ ok: false, error: "Check the highlighted fields.", fieldErrors: { reason: ["Required"] } });
    mocks.cancel.mockRejectedValue(new BookingError("UNAVAILABLE", "Already booked", [{ slotIndex: 0, start: new Date(), end: new Date(), violations: [{ code: "UNAVAILABLE", message: "Taken" }] }]));
    expect(await actions.cancelBooking(booking)).toEqual({ ok: false, error: "That time was just taken." });
  });
});
