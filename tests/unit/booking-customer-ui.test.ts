import { describe, expect, it } from "vitest";
import { bookingDate, bookingDayWindow, conflictDates, displayRates, durationChoices, navigateBookingDate, quoteDisplay } from "@/lib/bookings/publicUi";
import { expandRecurrence } from "@/lib/bookings/recurrence";
import { checkSlots } from "@/lib/bookings/slotCheck";
import { DEFAULT_RULES } from "@/lib/bookingRules/schema";
import { canReadBooking } from "@/lib/ics/access";
import { hashToken } from "@/lib/bookings/tokens";
import type { Quote } from "@/lib/pricing/quote";

describe("customer date navigation", () => {
  it("uses the makerspace's date across month and year boundaries", () => {
    expect(bookingDate(new Date("2026-12-31T23:00:00Z"), "Asia/Kolkata")).toBe("2027-01-01");
    expect(navigateBookingDate("2027-01-01", -1)).toBe("2026-12-31");
    expect(navigateBookingDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(() => navigateBookingDate("2026-02-29", 1)).toThrow();
  });
  it("navigates local days across both DST changes", () => {
    for (const [date, hours] of [["2026-03-29", 23], ["2026-10-25", 25]] as const) {
      const window = bookingDayWindow(date, "Europe/London");
      expect((window.end.getTime() - window.start.getTime()) / 3_600_000).toBe(hours);
      expect(bookingDate(window.end, "Europe/London")).toBe(navigateBookingDate(date, 1));
    }
  });
  it("offers only step-aligned durations within the configured limits", () => {
    expect(durationChoices(40, 125, 30)).toEqual([60, 90, 120]);
  });
});

describe("recurrence conflict listing", () => {
  it("lists the local date and reasons of a missing-hour occurrence", () => {
    const slots = expandRecurrence(new Date("2026-03-22T01:00:00Z"), new Date("2026-03-22T03:00:00Z"), "Europe/London", { frequency: "WEEKLY", count: 3 }, 52);
    const checked = checkSlots({ timeZone: "Europe/London", units: 1, rules: { ...DEFAULT_RULES, leadTimeMinutes: 0 },
      open: [{ start: Date.parse("2026-03-01Z"), end: Date.parse("2026-05-01Z") }], busy: [], blackouts: [] }, slots, 1, new Date("2026-03-01Z"), false);
    expect(conflictDates(checked.conflicts, "Europe/London")).toEqual([{ date: "2026-03-29", reasons: ["That time doesn't exist on this date (the clocks change)."] }]);
    expect(checked.allocations.map(Boolean)).toEqual([true, false, true]);
  });
  it("lists unavailable dates without changing the series order", () => {
    const starts = ["2026-11-01T20:00Z", "2026-11-08T20:00Z"].map((value) => new Date(value));
    expect(conflictDates(starts.map((start, slotIndex) => ({ slotIndex, start, end: new Date(start.getTime() + 3_600_000), violations: [{ code: "UNAVAILABLE", message: "Already booked." }] })), "Asia/Kolkata").map((row) => row.date)).toEqual(["2026-11-02", "2026-11-09"]);
  });
});

describe("quote display", () => {
  const quote = { lines: [{ description: "Studio", detail: "1 hour, member rate", amountMinor: 11800 }], rateKinds: ["MEMBER"], subtotalMinor: 10000, taxMinor: 1800, totalMinor: 11800 } as Pick<Quote, "lines" | "rateKinds" | "subtotalMinor" | "taxMinor" | "totalMinor">;
  it("preserves minor-unit amounts and labels member and mixed series", () => {
    expect(quoteDisplay(quote)).toMatchObject({ totalMinor: 11800, taxMinor: 1800, memberLabel: "Member rate applied", lines: [{ amountMinor: 11800 }] });
    expect(quoteDisplay({ ...quote, rateKinds: ["MEMBER", "PUBLIC"] }).memberLabel).toContain("eligible dates");
    expect(quoteDisplay({ ...quote, rateKinds: ["PUBLIC"] }).memberLabel).toBeNull();
  });
  it("shows lower member prices, zero prices, and configured block lengths", () => {
    expect(displayRates({ publicHourlyMinor: 0, memberHourlyMinor: 10, publicHalfDayMinor: 10000, memberHalfDayMinor: 8000, publicDayMinor: null, memberDayMinor: null, halfDayMinutes: 180, dayMinutes: 420 }))
      .toEqual([{ label: "per hour", price: 0, member: null }, { label: "per 3 hours", price: 10000, member: 8000 }]);
  });
});

describe("ICS and manage route authorisation", () => {
  const booking = { makerspaceId: "tenant", reference: "BK-123456", customerUserId: "owner", manageTokenHash: hashToken("private-token") };
  const request = { makerspaceId: "tenant", reference: "BK-123456" };
  it("accepts the private token or the signed-in owner independently", () => {
    expect(canReadBooking(booking, { ...request, token: "private-token" })).toBe(true);
    expect(canReadBooking(booking, { ...request, userId: "owner", token: "old-token" })).toBe(true);
  });
  it("rejects guessed references, other customers and revoked or foreign tokens", () => {
    for (const input of [{}, { token: "old-token" }, { userId: "other" }, { makerspaceId: "foreign", token: "private-token" }, { reference: "BK-654321", userId: "owner" }]) {
      expect(canReadBooking(booking, { ...request, ...input })).toBe(false);
    }
    expect(canReadBooking(null, { ...request, userId: "owner" })).toBe(false);
    expect(canReadBooking({ ...booking, customerUserId: null }, { ...request, userId: "owner" })).toBe(false);
  });
});
