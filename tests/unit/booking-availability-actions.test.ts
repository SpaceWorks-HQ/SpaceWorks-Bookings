import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), makerspace: vi.fn(), space: vi.fn(), booking: vi.fn(), anchor: vi.fn(), rows: vi.fn(), limited: vi.fn(), schedule: vi.fn(), tokenBooking: vi.fn(), plan: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { makerspace: { findUnique: mocks.makerspace }, space: { findFirst: mocks.space }, booking: { findFirst: mocks.booking }, bookingOccurrence: { findFirst: mocks.anchor, findMany: mocks.rows } } }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/permissions", () => ({ makerspaceActionAccess: vi.fn() }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: mocks.limited }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/availability/context", () => ({ loadSchedule: mocks.schedule }));
vi.mock("@/lib/bookings/links", () => ({ findBookingByManageToken: mocks.tokenBooking }));
vi.mock("@/lib/actions/publicBookingPlan", () => ({ publicBookingPlan: mocks.plan }));
import { loadBookingAvailability, previewBookingConflicts } from "@/app/actions/booking-availability";
import { hashToken } from "@/lib/bookings/tokens";
import { DEFAULT_RULES } from "@/lib/bookingRules/schema";

const input = { makerspaceSlug: "demo", spaceId: "room", date: "2026-11-02", duration: 60, quantity: 1 };
const access = { bookingId: "booking", occurrenceId: "row-0" };
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-01T00:00Z"));
  mocks.makerspace.mockResolvedValue({ id: "tenant", status: "ACTIVE", timezone: "UTC" });
  mocks.space.mockResolvedValue({ id: "room" }); mocks.auth.mockResolvedValue({ user: { id: "customer" } });
  mocks.booking.mockResolvedValue({ id: "booking", spaceId: "room", customerUserId: "customer", manageTokenHash: hashToken("token") });
  mocks.anchor.mockResolvedValue({ id: "row-0", slotIndex: 0 }); mocks.rows.mockResolvedValue([{ id: "row-0" }, { id: "row-1" }]);
  mocks.schedule.mockResolvedValue({ schedule: { timeZone: "UTC", units: 2, rules: { ...DEFAULT_RULES, leadTimeMinutes: 0, maxDurationMinutes: 43200 },
    open: [{ start: Date.parse("2026-11-02T09:00Z"), end: Date.parse("2026-11-05T09:00Z") }], blackouts: [], busy: [] } });
});

describe("customer availability action", () => {
  it("excludes only a verified guest hold in availability and conflict previews", async () => {
    const manageToken = "x".repeat(43);
    mocks.auth.mockResolvedValue(null);
    mocks.tokenBooking.mockResolvedValue({ id: "held", spaceId: "room", status: "HELD", holdExpiresAt: new Date("2026-11-01T00:15Z"), submittedAt: null, customerUserId: null, manageTokenHash: hashToken(manageToken) });
    mocks.plan.mockResolvedValue({ checked: { conflicts: [], allocations: [[0]] } });
    const owner = { bookingId: "held", manageToken };
    expect(await loadBookingAvailability({ ...input, ...owner })).toMatchObject({ ok: true });
    expect(mocks.schedule).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ excludeBookingIds: ["held"], includeHidden: false }));
    const preview = { makerspaceSlug: "demo", spaceId: "room", start: "2026-11-02T09:00:00Z", end: "2026-11-02T10:00:00Z", ...owner };
    expect(await previewBookingConflicts(preview)).toMatchObject({ ok: true, data: { availableCount: 1, conflicts: [] } });
    expect(mocks.plan).toHaveBeenCalledWith(expect.objectContaining({ excludeBookingIds: ["held"] }));
    mocks.schedule.mockClear(); mocks.plan.mockClear();
    mocks.tokenBooking.mockResolvedValue(null);
    expect(await loadBookingAvailability({ ...input, ...owner })).toMatchObject({ ok: false });
    expect(await previewBookingConflicts(preview)).toMatchObject({ ok: false });
    expect(mocks.schedule).not.toHaveBeenCalled(); expect(mocks.plan).not.toHaveBeenCalled(); vi.useRealTimers();
  });
  it("loads through the booking end when offering long durations", async () => {
    const result = await loadBookingAvailability({ ...input, duration: 2880 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data?.[0]).toMatchObject({ start: Date.parse("2026-11-02T09:00Z"), end: Date.parse("2026-11-04T09:00Z") });
    expect(mocks.schedule).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ makerspaceId: "tenant", from: new Date("2026-11-02T00:00Z"), to: new Date("2026-11-05T00:00Z") }));
    vi.useRealTimers();
  });
  it("excludes all units of only the owned reschedule slot", async () => {
    expect(await loadBookingAvailability({ ...input, quantity: 2, ...access })).toMatchObject({ ok: true });
    expect(mocks.anchor).toHaveBeenCalledWith({ where: { makerspaceId: "tenant", bookingId: "booking", id: "row-0" } });
    expect(mocks.rows).toHaveBeenCalledWith({ where: { makerspaceId: "tenant", bookingId: "booking", slotIndex: 0 }, select: { id: true } });
    expect(mocks.schedule).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ excludeOccurrenceIds: ["row-0", "row-1"], includeHidden: true }));
    vi.useRealTimers();
  });
  it("refuses foreign bookings and other spaces before reading a hidden schedule", async () => {
    mocks.booking.mockResolvedValueOnce(null);
    expect(await loadBookingAvailability({ ...input, ...access })).toMatchObject({ ok: false, error: "Booking not found." });
    expect(await loadBookingAvailability({ ...input, spaceId: "other-space", ...access })).toMatchObject({ ok: false });
    expect(mocks.schedule).not.toHaveBeenCalled(); vi.useRealTimers();
  });
  it("does not read unpublished spaces or inactive makerspaces for new bookings", async () => {
    mocks.space.mockResolvedValue(null);
    expect(await loadBookingAvailability(input)).toMatchObject({ ok: false, error: "Space not found." });
    mocks.makerspace.mockResolvedValue({ id: "tenant", status: "SUSPENDED", timezone: "UTC" });
    expect(await loadBookingAvailability(input)).toMatchObject({ ok: false, error: "Makerspace not found." });
    expect(mocks.schedule).not.toHaveBeenCalled(); vi.useRealTimers();
  });
});
