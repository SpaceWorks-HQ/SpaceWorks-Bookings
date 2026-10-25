import { describe, expect, it } from "vitest";
import { BOOKING_NOTICES } from "@/lib/bookings/notify";
import { bookingEmailContent, describeSlots, type BookingEmailData } from "@/lib/email/bookingContent";
import { asBookingNoticePayload } from "@/lib/email/bookings";
import { renderBrandedEmail } from "@/lib/email/message";

function data(over: Partial<BookingEmailData> = {}, booking: Partial<BookingEmailData["booking"]> = {}): BookingEmailData {
  return {
    notice: "confirmed",
    makerspace: { name: "Tinkerspace", timezone: "Asia/Kolkata", locale: null },
    spaceName: "Studio A",
    booking: { reference: "BK-7Q2M9X", status: "CONFIRMED", contactName: "Asha Menon", currency: "INR", totalMinor: 118_000, depositMinor: 0, chargeMinor: 118_000, paidMinor: 0, refundedMinor: 0, paymentDueAt: new Date("2026-11-09T04:30:00Z"), payLater: true, awaitingPayment: false, chargeMode: "PAY_LATER", ...booking },
    slots: [{ startsAt: new Date("2026-11-10T04:30:00Z"), endsAt: new Date("2026-11-10T06:30:00Z") }],
    manageUrl: "https://bookings.demo.test/m/tinkerspace/bookings/BK-7Q2M9X?t=token",
    pageUrl: "https://bookings.demo.test/m/tinkerspace",
    checkInCode: "BK-7Q2M9X-ABCDEFGH",
    ...over,
  };
}

describe("booking emails", () => {
  it("have copy for every notice, in sentence case without exclamation marks", () => {
    for (const notice of BOOKING_NOTICES) {
      const content = bookingEmailContent(data({ notice }));
      expect(content.subject.length, notice).toBeGreaterThan(5);
      expect(content.paragraphs.join(" "), notice).not.toMatch(/!|Oops/);
      expect(content.heading[0], notice).toBe(content.heading[0].toUpperCase());
      expect(content.paragraphs.join(" "), notice).toContain("BK-7Q2M9X");
      const { html, text } = renderBrandedEmail(content);
      expect(html).toContain("Tinkerspace");
      expect(text).toContain(content.heading);
    }
  });

  it("show the pay-later balance and due date, and the check-in code", () => {
    const text = bookingEmailContent(data()).paragraphs.join("\n");
    expect(text).toContain("Payment pending: ₹1,180.00 to pay by 9 Nov 2026.");
    expect(text).toContain("Your check-in code is BK-7Q2M9X-ABCDEFGH.");
    expect(text).toContain("Tue 10 Nov 2026, 10:00 AM – 12:00 PM IST");
  });

  it("say nothing is due before approval and nothing to pay when free", () => {
    expect(bookingEmailContent(data({ notice: "requested" }, { status: "REQUESTED" })).paragraphs.join(" ")).toContain("You pay nothing until the request is approved.");
    expect(bookingEmailContent(data({}, { totalMinor: 0, chargeMinor: 0, chargeMode: "FREE" })).paragraphs.join(" ")).toContain("There's nothing to pay.");
    expect(bookingEmailContent(data({ notice: "received" }, { status: "HELD", awaitingPayment: true, depositMinor: 59_000, chargeMode: "DEPOSIT" })).paragraphs.join(" ")).toContain("Payment pending: ₹590.00. Contact Tinkerspace to arrange payment before your hold expires.");
  });

  it("show kept fees and refunds on cancellation", () => {
    const text = bookingEmailContent(data({ notice: "cancelled", keptFeeMinor: 59_000, refundDueMinor: 59_000 }, { paidMinor: 118_000, chargeMinor: 59_000 })).paragraphs.join("\n");
    expect(text).toContain("Cancellation fee kept under the policy: ₹590.00.");
    expect(text).toContain("Refund due to you: ₹590.00.");
  });

  it("use the manage link only when the email carries one", () => {
    expect(bookingEmailContent(data()).action.label).toBe("Manage your booking");
    expect(bookingEmailContent(data({ manageUrl: null })).action).toEqual({ label: "Visit Tinkerspace", url: "https://bookings.demo.test/m/tinkerspace" });
  });

  it("list at most six times", () => {
    const slots = Array.from({ length: 9 }, (_, index) => ({ startsAt: new Date(Date.UTC(2026, 10, 2 + index, 4, 30)), endsAt: new Date(Date.UTC(2026, 10, 2 + index, 5, 30)) }));
    expect(describeSlots(slots, "Asia/Kolkata").at(-1)).toBe("and 3 more");
  });
});

describe("booking notice payloads", () => {
  it("accept well-formed payloads and refuse the rest", () => {
    expect(asBookingNoticePayload({ makerspaceId: "m", bookingId: "b", notice: "confirmed" })).toBeTruthy();
    expect(asBookingNoticePayload({ makerspaceId: "m", bookingId: "b", notice: "nope" })).toBeNull();
    expect(asBookingNoticePayload({ makerspaceId: "m", bookingId: "b", notice: "cancelled", keptFeeMinor: -1 })).toBeNull();
    expect(asBookingNoticePayload({ makerspaceId: "m", bookingId: "b", notice: "cancelled", occurrenceIds: [1] })).toBeNull();
    expect(asBookingNoticePayload(["m"])).toBeNull();
  });
});
