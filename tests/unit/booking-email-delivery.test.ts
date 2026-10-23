import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ booking: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { booking: { findFirst: mocks.booking } } }));
vi.mock("@/lib/email/message", () => ({ sendBrandedEmail: mocks.send, absoluteUrl: (path: string) => `https://example.test${path}` }));
import { deliverBookingNotice } from "@/lib/email/bookings";
import { BOOKING_NOTICES } from "@/lib/bookings/notify";

const row = { id: "occurrence", slotIndex: 0, unit: 0, startsAt: new Date("2026-11-01T10:00Z"), endsAt: new Date("2026-11-01T11:00Z"), status: "SCHEDULED", sequence: 2, updatedAt: new Date("2026-10-25T10:00Z") };
const booking = { id: "booking", makerspaceId: "tenant", reference: "BK-123456", status: "CONFIRMED", contactName: "Customer", contactEmail: "customer@example.test",
  currency: "INR", chargeMode: "PAY_LATER", totalMinor: 10000, chargeMinor: 10000, depositMinor: 0, paidMinor: 0, refundedMinor: 0, paymentDueAt: new Date("2026-10-31T10:00Z"), payLater: true, awaitingPayment: false,
  makerspace: { slug: "demo", name: "Demo", timezone: "UTC", locale: null, contactEmail: "team@example.test", contactPhone: null, addressLine: null, city: null }, space: { name: "Studio" }, occurrences: [row] };
beforeEach(() => { vi.resetAllMocks(); mocks.booking.mockResolvedValue(booking); });

describe("booking notice delivery", () => {
  it("uses makerspace SMTP and a manage-page link for every notice", async () => {
    for (const notice of BOOKING_NOTICES) {
      const status = ({ received: "HELD", requested: "REQUESTED", declined: "DECLINED", "request-expired": "EXPIRED", cancelled: "CANCELLED" } as Record<string, string>)[notice] ?? "CONFIRMED";
      mocks.booking.mockResolvedValue({ ...booking, status, occurrences: [{ ...row, status: ["DECLINED", "EXPIRED", "CANCELLED"].includes(status) ? "CANCELLED" : "SCHEDULED" }] });
      expect(await deliverBookingNotice({ makerspaceId: "tenant", bookingId: "booking", notice }, "outbox-id")).toBe("sent");
      expect(mocks.send).toHaveBeenLastCalledWith(expect.objectContaining({ makerspaceId: "tenant", to: "customer@example.test", messageId: "outbox-id", action: { label: "Manage your booking", url: "https://example.test/m/demo/bookings/BK-123456" } }));
    }
  });
  it("drops non-recovery, non-cancellation notices after the booking ends, even with explicit occurrence ids", async () => {
    for (const status of ["CANCELLED", "DECLINED", "EXPIRED"]) {
      mocks.booking.mockResolvedValue({ ...booking, status, occurrences: [{ ...row, status: "CANCELLED" }] });
      for (const notice of BOOKING_NOTICES.filter((notice) => !["manage-link", "cancelled", "declined", "request-expired"].includes(notice))) {
        expect(await deliverBookingNotice({ makerspaceId: "tenant", bookingId: "booking", notice, occurrenceIds: [row.id] }, "id")).toBe("dropped");
      }
    }
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it.each(["HELD", "REQUESTED", "CONFIRMED", "CANCELLED", "DECLINED", "EXPIRED"])("delivers recovery links for %s bookings including cancelled occurrences", async (status) => {
    mocks.booking.mockResolvedValue({ ...booking, status, occurrences: [{ ...row, status: "CANCELLED" }] });
    expect(await deliverBookingNotice({ makerspaceId: "tenant", bookingId: "booking", notice: "manage-link", manageToken: "recovered", occurrenceIds: [row.id] }, "id")).toBe("sent");
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      action: { label: "Manage your booking", url: "https://example.test/m/demo/bookings/BK-123456?t=recovered" }, attachments: [],
    }));
  });
  it("drops superseded statuses and cancelled targets of a still-live series", async () => {
    for (const notice of ["received", "requested", "declined", "request-expired"] as const) {
      expect(await deliverBookingNotice({ makerspaceId: "tenant", bookingId: "booking", notice }, "id")).toBe("dropped");
    }
    mocks.booking.mockResolvedValue({ ...booking, occurrences: [{ ...row, status: "CANCELLED" }, { ...row, id: "live", slotIndex: 1 }] });
    expect(await deliverBookingNotice({ makerspaceId: "tenant", bookingId: "booking", notice: "rescheduled", occurrenceIds: [row.id] }, "id")).toBe("dropped");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(await deliverBookingNotice({ makerspaceId: "tenant", bookingId: "booking", notice: "cancelled", occurrenceIds: [row.id] }, "id")).toBe("sent");
    expect(await deliverBookingNotice({ makerspaceId: "tenant", bookingId: "booking", notice: "confirmed" }, "id")).toBe("sent");
    const invite = mocks.send.mock.calls.at(-1)![0].attachments[0].content.toString();
    expect(invite).toContain("live"); expect(invite).not.toContain("UID:occurrence");
  });
  it("links a fresh token to the reference route and attaches the confirmation invite", async () => {
    await deliverBookingNotice({ makerspaceId: "tenant", bookingId: "booking", notice: "confirmed", manageToken: "private-token" }, "id");
    const sent = mocks.send.mock.calls[0][0];
    expect(sent.action.url).toBe("https://example.test/m/demo/bookings/BK-123456?t=private-token");
    expect(sent.attachments[0].contentType).toContain("method=REQUEST");
    expect(sent.attachments[0].content.toString()).toContain("SEQUENCE:2");
  });
  it("sends declined and expired notices even after all occurrence rows were cancelled", async () => {
    for (const notice of ["declined", "request-expired"] as const) {
      mocks.booking.mockResolvedValue({ ...booking, status: notice === "declined" ? "DECLINED" : "EXPIRED", occurrences: [{ ...row, status: "CANCELLED" }] });
      expect(await deliverBookingNotice({ makerspaceId: "tenant", bookingId: "booking", notice }, "id")).toBe("sent");
    }
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });
  it("attaches updated REQUEST and CANCEL files with the stored sequence", async () => {
    for (const [notice, method] of [["rescheduled", "REQUEST"], ["cancelled", "CANCEL"]] as const) {
      mocks.booking.mockResolvedValue({ ...booking, occurrences: [{ ...row, sequence: 4, status: notice === "cancelled" ? "CANCELLED" : "SCHEDULED" }] });
      await deliverBookingNotice({ makerspaceId: "tenant", bookingId: "booking", notice, occurrenceIds: [row.id] }, "id");
      const sent = mocks.send.mock.calls.at(-1)![0];
      expect(sent.attachments[0].content.toString()).toContain(`METHOD:${method}`);
      expect(sent.attachments[0].content.toString()).toContain("SEQUENCE:4");
    }
  });
});
