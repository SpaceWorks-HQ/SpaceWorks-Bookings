import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ makerspace: vi.fn(), booking: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { makerspace: { findUnique: mocks.makerspace }, booking: { findFirst: mocks.booking } } }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
import { GET } from "@/app/api/bookings/[makerspaceSlug]/[reference]/calendar/route";
import { hashToken } from "@/lib/bookings/tokens";

const params = { params: Promise.resolve({ makerspaceSlug: "demo", reference: "BK-123456" }) };
const token = "x".repeat(43);
const row = { id: "occurrence", slotIndex: 0, unit: 0, startsAt: new Date("2026-11-01T10:00Z"), endsAt: new Date("2026-11-01T11:00Z"), status: "SCHEDULED", sequence: 3, updatedAt: new Date("2026-10-25T10:00Z") };
const booking = { makerspaceId: "tenant", reference: "BK-123456", customerUserId: "customer", manageTokenHash: hashToken(token), status: "CONFIRMED", contactName: "Customer", contactEmail: "customer@example.test", space: { name: "Studio" }, occurrences: [row] };
const request = (suffix = "") => new Request(`https://example.test/api/bookings/demo/BK-123456/calendar${suffix}`);
beforeEach(() => {
  vi.resetAllMocks(); mocks.makerspace.mockResolvedValue({ id: "tenant", name: "Demo", contactEmail: "team@example.test", addressLine: "Street", city: "City" }); mocks.booking.mockResolvedValue(booking);
});

describe("booking ICS download", () => {
  it("returns a private invite by manage token with stable UID and sequence", async () => {
    const response = await GET(request(`?t=${token}`), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="BK-123456.ics"');
    const calendar = await response.text();
    expect(calendar).toContain("METHOD:REQUEST"); expect(calendar).toContain("UID:occurrence@bookings.spaceworks"); expect(calendar).toContain("SEQUENCE:3");
    expect(calendar).not.toContain(token);
  });
  it("allows the signed-in customer and returns cancellation updates", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "customer" } });
    mocks.booking.mockResolvedValue({ ...booking, status: "CANCELLED", occurrences: [{ ...row, status: "CANCELLED", sequence: 4 }] });
    const response = await GET(request(), params);
    expect(response.status).toBe(200); expect(await response.text()).toContain("METHOD:CANCEL");
  });
  it("gives the same private 404 for wrong, missing and revoked tokens or another tenant", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "other" } });
    for (const suffix of ["", "?t=wrong", `?t=${"a".repeat(43)}`]) {
      const response = await GET(request(suffix), params);
      expect(response.status).toBe(404); expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    mocks.booking.mockResolvedValue({ ...booking, makerspaceId: "foreign" });
    expect((await GET(request(`?t=${token}`), params)).status).toBe(404);
    expect(mocks.booking).toHaveBeenCalledWith(expect.objectContaining({ where: { makerspaceId: "tenant", reference: "BK-123456" } }));
    mocks.booking.mockResolvedValue(null); expect((await GET(request(`?t=${token}`), params)).status).toBe(404);
  });
});
