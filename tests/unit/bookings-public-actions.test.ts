import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(), limited: vi.fn(), blocked: vi.fn(), makerspace: vi.fn(), space: vi.fn(), user: vi.fn(), booking: vi.fn(), rules: vi.fn(),
  hold: vi.fn(), submit: vi.fn(), preview: vi.fn(), tokenBooking: vi.fn(), link: vi.fn(), cancel: vi.fn(), reschedule: vi.fn(),
  issueFeed: vi.fn(), revokeFeed: vi.fn(), revalidate: vi.fn(), plan: vi.fn(), release: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ prisma: { makerspace: { findUnique: mocks.makerspace }, space: { findFirst: mocks.space }, user: { findUnique: mocks.user }, booking: { findFirst: mocks.booking } } }));
vi.mock("@/lib/permissions", () => ({ makerspaceActionAccess: vi.fn() }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: mocks.limited }));
vi.mock("@/lib/ipBlock", () => ({ currentRequestBlocked: mocks.blocked }));
vi.mock("@/lib/bookingRules/service", () => ({ getSpaceRules: mocks.rules }));
vi.mock("@/lib/actions/publicBookingPlan", () => ({ publicBookingPlan: mocks.plan }));
vi.mock("@/lib/bookings/hold", () => ({ createHold: mocks.hold }));
vi.mock("@/lib/bookings/expiry", () => ({ releaseHold: mocks.release }));
vi.mock("@/lib/bookings/submit", () => ({ submitBooking: mocks.submit }));
vi.mock("@/lib/bookings/quote", () => ({ previewQuote: mocks.preview }));
vi.mock("@/lib/bookings/links", () => ({ findBookingByManageToken: mocks.tokenBooking, requestManageLink: mocks.link }));
vi.mock("@/lib/bookings/cancel", () => ({ cancelBooking: mocks.cancel }));
vi.mock("@/lib/bookings/reschedule", () => ({ rescheduleOccurrence: mocks.reschedule }));
vi.mock("@/lib/ics/feeds", () => ({ issueCalendarFeed: mocks.issueFeed, revokeCalendarFeed: mocks.revokeFeed }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import * as actions from "@/app/actions/bookings-public";
import { DEFAULT_RULES } from "@/lib/bookingRules/schema";
import { BookingError } from "@/lib/bookings/errors";
import { hashToken } from "@/lib/bookings/tokens";

const slug = { makerspaceSlug: "tinkerspace" };
const slot = { start: "2026-11-01T09:00:00Z", end: "2026-11-01T10:00:00Z" };
const hold = { ...slug, ...slot, spaceId: "room" };
const manageToken = "x".repeat(43);
const booking = { id: "booking", spaceId: "room", status: "HELD", submittedAt: null, holdExpiresAt: new Date("2099-01-01"), customerUserId: "customer", manageTokenHash: hashToken(manageToken) };
const submit = { ...slug, bookingId: "booking", contact: { name: "Customer", email: "contact@example.test" }, attendees: 2 };
const reschedule = { ...slug, ...slot, bookingId: "booking", occurrenceId: "occurrence" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "customer" } });
  mocks.makerspace.mockResolvedValue({ id: "tenant", status: "ACTIVE", timezone: "UTC" });
  mocks.space.mockResolvedValue({ id: "room" }); mocks.booking.mockResolvedValue(booking); mocks.tokenBooking.mockResolvedValue(booking);
  mocks.rules.mockResolvedValue({ values: { ...DEFAULT_RULES, guestBookingAllowed: true } });
  mocks.user.mockResolvedValue({ email: "verified@example.test", emailVerified: new Date() });
  mocks.hold.mockResolvedValue({ bookingId: "booking", manageToken }); mocks.submit.mockResolvedValue({ status: "CONFIRMED" });
  mocks.preview.mockResolvedValue({ totalMinor: 0 }); mocks.cancel.mockResolvedValue({ bookingStatus: "CANCELLED" });
});

describe("public booking action security", () => {
  it("requires the hold token to release a guest's own hold", async () => {
    mocks.auth.mockResolvedValue(null); mocks.tokenBooking.mockResolvedValue({ ...booking, customerUserId: null });
    mocks.release.mockResolvedValue({ released: true });
    const input = { ...slug, bookingId: booking.id, manageToken };
    expect(await actions.releaseHold(input)).toMatchObject({ ok: true, data: { released: true } });
    expect(mocks.tokenBooking).toHaveBeenCalledWith("tenant", manageToken);
    expect(mocks.release).toHaveBeenCalledWith({ makerspaceId: "tenant", bookingId: booking.id, actor: { kind: "CUSTOMER", userId: null, manageToken } });
    mocks.release.mockClear();
    expect(await actions.releaseHold({ ...slug, bookingId: booking.id })).toMatchObject({ ok: false, fieldErrors: expect.any(Object) });
    for (const found of [null, { ...booking, id: "foreign" }, { ...booking, customerUserId: null, manageTokenHash: hashToken("wrong") }]) {
      mocks.tokenBooking.mockResolvedValue(found);
      expect(await actions.releaseHold(input)).toMatchObject({ ok: false, code: "HOLD_GONE" });
    }
    expect(mocks.release).not.toHaveBeenCalled();
  });
  it.each([
    { status: "EXPIRED" }, { status: "CONFIRMED" }, { submittedAt: new Date() },
    { holdExpiresAt: new Date(0) }, { holdExpiresAt: null },
  ])("returns HOLD_GONE for unusable holds: %j", async (change) => {
    mocks.booking.mockResolvedValue({ ...booking, ...change });
    const owner = { bookingId: booking.id };
    expect(await actions.submitBooking(submit)).toMatchObject({ ok: false, code: "HOLD_GONE" });
    expect(await actions.previewQuote({ ...hold, ...owner })).toMatchObject({ ok: false, code: "HOLD_GONE" });
    expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("preserves HOLD_GONE when a hold changes during submission", async () => {
    mocks.submit.mockRejectedValue(new BookingError("HOLD_GONE", "This booking was already submitted."));
    expect(await actions.submitBooking(submit)).toEqual({ ok: false, error: "This booking was already submitted.", code: "HOLD_GONE" });
  });
  it.each(["SUSPENDED", "ARCHIVED", "PENDING_REVIEW"])("blocks both reschedules at %s makerspaces while permitting cancellation", async (status) => {
    mocks.makerspace.mockResolvedValue({ id: "tenant", status, timezone: "UTC" });
    expect(await actions.rescheduleOccurrence(reschedule)).toEqual({ ok: false, error: "Makerspace not found." });
    const { bookingId: _, ...tokenInput } = reschedule; void _;
    expect(await actions.rescheduleByManageToken({ ...tokenInput, manageToken })).toEqual({ ok: false, error: "Makerspace not found." });
    expect(mocks.reschedule).not.toHaveBeenCalled();
    expect(await actions.cancelBooking({ ...slug, bookingId: "booking" })).toMatchObject({ ok: true });
    expect(await actions.cancelByManageToken({ ...slug, manageToken })).toMatchObject({ ok: true });
  });
  it("rejects effective duration, advance and expanded-window limits before pricing", async () => {
    mocks.rules.mockResolvedValue({ values: { ...DEFAULT_RULES, maxDurationMinutes: 30 } });
    expect(await actions.previewQuote(hold)).toMatchObject({ ok: false });
    mocks.rules.mockResolvedValue({ values: DEFAULT_RULES });
    expect(await actions.previewQuote({ ...hold, start: "2028-09-01T09:00:00Z", end: "2028-09-01T10:00:00Z" })).toMatchObject({ ok: false });
    expect(await actions.previewQuote({ ...hold, recurrence: { frequency: "WEEKLY", interval: 12, count: 10 } })).toMatchObject({ ok: false });
    expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.plan).not.toHaveBeenCalled();
  });
  it("verifies a guest's hold before excluding it from a skipped-conflict quote", async () => {
    mocks.auth.mockResolvedValue(null); mocks.tokenBooking.mockResolvedValue({ ...booking, customerUserId: null });
    mocks.plan.mockResolvedValue({ slots: [{ start: new Date(slot.start), end: new Date(slot.end) }], checked: { allocations: [[0]] } });
    const input = { ...hold, bookingId: "booking", manageToken, skipConflicts: true };
    expect(await actions.previewQuote(input)).toMatchObject({ ok: true });
    expect(mocks.plan).toHaveBeenCalledWith(expect.objectContaining({ excludeBookingIds: ["booking"] }));
    mocks.plan.mockClear(); mocks.preview.mockClear();
    for (const change of [{ id: "other" }, { spaceId: "other" }, { status: "CONFIRMED" }, { manageTokenHash: hashToken("wrong") }]) {
      mocks.tokenBooking.mockResolvedValue({ ...booking, customerUserId: null, ...change });
      expect(await actions.previewQuote(input)).toMatchObject({ ok: false });
    }
    expect(mocks.plan).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("passes only a customer actor and PUBLIC source to holds", async () => {
    expect(await actions.createHold(hold)).toMatchObject({ ok: true });
    expect(mocks.hold).toHaveBeenCalledWith(expect.objectContaining({ makerspaceId: "tenant", source: "PUBLIC", actor: { kind: "CUSTOMER", userId: "customer" }, start: new Date(slot.start) }));
    expect(mocks.limited).toHaveBeenCalledWith("create");
  });
  it("refuses an injected staff actor before looking up anything", async () => {
    expect(await actions.createHold({ ...hold, actor: { kind: "STAFF" } })).toMatchObject({ ok: false, fieldErrors: expect.any(Object) });
    expect(mocks.makerspace).not.toHaveBeenCalled(); expect(mocks.hold).not.toHaveBeenCalled();
  });
  it.each(["SUSPENDED", "ARCHIVED", "PENDING_REVIEW"])("refuses new bookings at a %s makerspace", async (status) => {
    mocks.makerspace.mockResolvedValue({ id: "tenant", status });
    expect(await actions.createHold(hold)).toEqual({ ok: false, error: "Makerspace not found." });
    expect(await actions.submitBooking(submit)).toEqual({ ok: false, error: "Makerspace not found." });
    expect(mocks.hold).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("requires a published, unarchived space in this makerspace on hold and submit", async () => {
    mocks.space.mockResolvedValue(null);
    expect(await actions.createHold(hold)).toEqual({ ok: false, error: "Space not found." });
    expect(await actions.submitBooking(submit)).toEqual({ ok: false, error: "Space not found." });
    expect(mocks.space).toHaveBeenCalledWith({ where: { id: "room", makerspaceId: "tenant", published: true, archivedAt: null } });
    expect(mocks.hold).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("does not call booking services when rate limited", async () => {
    mocks.limited.mockResolvedValue(true);
    expect(await actions.createHold(hold)).toMatchObject({ ok: false });
    expect(mocks.hold).not.toHaveBeenCalled();
  });
  it("expands recurrence and uses only the verified account email for a quote", async () => {
    expect(await actions.previewQuote({ ...hold, recurrence: { frequency: "WEEKLY", count: 3 } })).toMatchObject({ ok: true });
    expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({ memberEmail: "verified@example.test", slots: [
      expect.objectContaining({ start: new Date(slot.start) }), expect.objectContaining({ start: new Date("2026-11-08T09:00:00Z") }), expect.objectContaining({ start: new Date("2026-11-15T09:00:00Z") }),
    ] }));
  });
  it("never grants member pricing from an unverified or guest email", async () => {
    mocks.user.mockResolvedValue({ email: "unverified@example.test", emailVerified: null });
    await actions.previewQuote(hold);
    expect(mocks.preview).toHaveBeenLastCalledWith(expect.objectContaining({ memberEmail: null }));
    mocks.auth.mockResolvedValue(null);
    await actions.previewQuote(hold);
    expect(mocks.preview).toHaveBeenLastCalledWith(expect.objectContaining({ memberEmail: null }));
  });
  it("refuses a recurrence longer than the effective limit", async () => {
    mocks.rules.mockResolvedValue({ values: { ...DEFAULT_RULES, recurrenceMaxOccurrences: 2 } });
    expect(await actions.previewQuote({ ...hold, recurrence: { frequency: "DAILY", count: 3 } })).toMatchObject({ ok: false });
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("quotes only the remaining slots when conflicts are skipped", async () => {
    const slots = [0, 1, 2].map((index) => ({ start: new Date(Date.parse(slot.start) + index * 86_400_000), end: new Date(Date.parse(slot.end) + index * 86_400_000) }));
    mocks.plan.mockResolvedValue({ slots, checked: { allocations: [[0], null, [0]] } });
    expect(await actions.previewQuote({ ...hold, recurrence: { frequency: "DAILY", count: 3 }, skipConflicts: true })).toMatchObject({ ok: true });
    expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({ slots: [slots[0], slots[2]] }));
    mocks.plan.mockResolvedValue({ slots, checked: { allocations: [null, null, null] } });
    mocks.preview.mockClear();
    expect(await actions.previewQuote({ ...hold, skipConflicts: true })).toMatchObject({ ok: false });
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("submits a guest hold only with its token and when guests are still allowed", async () => {
    mocks.auth.mockResolvedValue(null); mocks.tokenBooking.mockResolvedValue({ ...booking, customerUserId: null });
    expect(await actions.submitBooking({ ...submit, manageToken })).toMatchObject({ ok: true });
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ actor: { kind: "CUSTOMER", userId: null, manageToken } }));
    mocks.submit.mockClear(); mocks.rules.mockResolvedValue({ values: DEFAULT_RULES });
    expect(await actions.submitBooking({ ...submit, manageToken })).toEqual({ ok: false, error: "Sign in to book this space." });
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("does not accept a token for a different hold id", async () => {
    mocks.tokenBooking.mockResolvedValue({ ...booking, id: "different" });
    expect(await actions.submitBooking({ ...submit, manageToken })).toEqual({ ok: false, error: "Booking not found.", code: "HOLD_GONE" });
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("uses scoped manage-token lookup and customer cancellation policy", async () => {
    mocks.auth.mockResolvedValue(null);
    expect(await actions.cancelByManageToken({ ...slug, manageToken, scope: { type: "FOLLOWING", occurrenceId: "o" } })).toMatchObject({ ok: true });
    expect(mocks.tokenBooking).toHaveBeenCalledWith("tenant", manageToken);
    expect(mocks.cancel).toHaveBeenCalledWith(expect.objectContaining({ bookingId: "booking", kind: "CUSTOMER", scope: { type: "FOLLOWING", occurrenceId: "o" }, actor: { kind: "CUSTOMER", userId: null, manageToken } }));
  });
  it("hides unknown tokens, foreign ids and bookings owned by another account", async () => {
    mocks.tokenBooking.mockResolvedValue(null);
    expect(await actions.cancelByManageToken({ ...slug, manageToken })).toEqual({ ok: false, error: "Booking not found." });
    mocks.booking.mockResolvedValue({ ...booking, customerUserId: "other" });
    expect(await actions.cancelBooking({ ...slug, bookingId: "foreign" })).toEqual({ ok: false, error: "Booking not found." });
    expect(mocks.booking).toHaveBeenCalledWith({ where: { id: "foreign", makerspaceId: "tenant" } });
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it("keeps signed-in and token reschedules inside customer rules", async () => {
    await actions.rescheduleOccurrence(reschedule);
    expect(mocks.reschedule).toHaveBeenCalledWith(expect.objectContaining({ actor: { kind: "CUSTOMER", userId: "customer", manageToken: undefined } }));
    mocks.reschedule.mockRejectedValue(new BookingError("CUTOFF_PASSED", "It's too late to move this booking online. Contact the makerspace."));
    const { bookingId: _, ...tokenInput } = reschedule; void _;
    expect(await actions.rescheduleByManageToken({ ...tokenInput, manageToken })).toMatchObject({ ok: false, error: "It's too late to move this booking online. Contact the makerspace." });
  });
  it("issues and revokes only the signed-in customer's calendar feed", async () => {
    await actions.issuePersonalCalendarFeed(slug); await actions.revokePersonalCalendarFeed(slug);
    expect(mocks.issueFeed).toHaveBeenCalledWith(expect.objectContaining({ makerspaceId: "tenant", kind: "CUSTOMER", actor: { kind: "CUSTOMER", userId: "customer" } }));
    expect(mocks.revokeFeed).toHaveBeenCalledWith({ makerspaceId: "tenant", userId: "customer", kind: "CUSTOMER" });
    mocks.auth.mockResolvedValue(null); mocks.issueFeed.mockClear();
    expect(await actions.issuePersonalCalendarFeed(slug)).toMatchObject({ ok: false }); expect(mocks.issueFeed).not.toHaveBeenCalled();
  });
  it("maps conflicts and hides unexpected service errors", async () => {
    mocks.hold.mockRejectedValue(new Error("23P01 database detail"));
    expect(await actions.createHold(hold)).toEqual({ ok: false, error: "That time was just taken." });
    mocks.hold.mockRejectedValue(new Error("postgres://secret"));
    expect(await actions.createHold(hold)).toEqual({ ok: false, error: "Could not save your changes. Please try again." });
  });
});

describe("manage-link enumeration protection", () => {
  const input = { ...slug, reference: "BK-123456", email: "Customer@Example.test" };
  const answer = { ok: true, data: { sent: true } };
  it("answers identically for matches, unknown makerspaces and rate limits", async () => {
    expect(await actions.requestManageLink(input)).toEqual(answer);
    expect(mocks.link).toHaveBeenCalledWith(expect.objectContaining({ email: "customer@example.test", makerspaceId: "tenant" }));
    mocks.makerspace.mockResolvedValue(null); expect(await actions.requestManageLink(input)).toEqual(answer);
    mocks.limited.mockResolvedValue(true); expect(await actions.requestManageLink(input)).toEqual(answer);
    expect(mocks.link).toHaveBeenCalledOnce();
  });
  it("does not reveal a matching booking when delivery fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.link.mockRejectedValue(new Error("private failure"));
    expect(await actions.requestManageLink(input)).toEqual(answer);
    expect(log).toHaveBeenCalledWith("[bookings] manage link request failed"); log.mockRestore();
  });
});
