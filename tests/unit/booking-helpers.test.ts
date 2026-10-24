import { describe, expect, it } from "vitest";
import { DEFAULT_RULES } from "@/lib/bookingRules/schema";
import { approvalDueAt, payLaterDueAt, payLaterOffered } from "@/lib/bookings/paymentDue";
import { expandRecurrence, RecurrenceError } from "@/lib/bookings/recurrence";
import { BOOKING_TRANSITIONS, bookingBlocks, canTransition } from "@/lib/bookings/status";
import { checkInCode, hashToken, manageTokenMatches, newManageToken, newReference, REFERENCE_PATTERN, verifyCheckInCode } from "@/lib/bookings/tokens";
import { allocateUnits, overlappingSlots } from "@/lib/bookings/units";
import { isExclusionViolation } from "@/lib/bookings/errors";
import { parseDateKey } from "@/lib/time/zoned";

const iso = (date: Date) => date.toISOString();

describe("recurrence", () => {
  const start = new Date("2026-11-02T04:30:00Z"); // Monday 10:00 IST
  const end = new Date("2026-11-02T06:30:00Z");

  it("repeats weekly by count and daily until a date, inclusive", () => {
    const weekly = expandRecurrence(start, end, "Asia/Kolkata", { frequency: "WEEKLY", count: 3 }, 52);
    expect(weekly.map((slot) => iso(slot.start))).toEqual(["2026-11-02T04:30:00.000Z", "2026-11-09T04:30:00.000Z", "2026-11-16T04:30:00.000Z"]);
    const daily = expandRecurrence(start, end, "Asia/Kolkata", { frequency: "DAILY", interval: 2, until: parseDateKey("2026-11-06")! }, 52);
    expect(daily.map((slot) => iso(slot.start))).toEqual(["2026-11-02T04:30:00.000Z", "2026-11-04T04:30:00.000Z", "2026-11-06T04:30:00.000Z"]);
    expect(expandRecurrence(start, end, "Asia/Kolkata", null, 52)).toEqual([{ start, end, nonexistent: false }]);
  });

  it("keeps local wall-clock times across DST and marks times that don't exist", () => {
    const slots = expandRecurrence(new Date("2026-03-21T01:30:00Z"), new Date("2026-03-21T02:30:00Z"), "Europe/London", { frequency: "WEEKLY", count: 3 }, 52);
    expect(slots.map((slot) => [iso(slot.start), slot.nonexistent])).toEqual([
      ["2026-03-21T01:30:00.000Z", false],
      ["2026-03-28T01:30:00.000Z", false],
      ["2026-04-04T00:30:00.000Z", false],
    ]);
    const gap = expandRecurrence(new Date("2026-03-22T01:30:00Z"), new Date("2026-03-22T02:30:00Z"), "Europe/London", { frequency: "WEEKLY", count: 2 }, 52);
    expect(gap[1].nonexistent).toBe(true);
  });

  it("refuses series that are too long or open-ended", () => {
    expect(() => expandRecurrence(start, end, "Asia/Kolkata", { frequency: "DAILY", count: 53 }, 52)).toThrow(RecurrenceError);
    expect(() => expandRecurrence(start, end, "Asia/Kolkata", { frequency: "DAILY" }, 52)).toThrow(RecurrenceError);
    expect(() => expandRecurrence(start, end, "Asia/Kolkata", { frequency: "DAILY", count: 2, interval: 13 }, 52)).toThrow(RecurrenceError);
  });
});

describe("unit allocation", () => {
  it("takes the lowest free units, the same ones across a series when it can", () => {
    expect(allocateUnits([[0, 1, 2], [1, 2], [0, 1, 2]], 1)).toEqual([[1], [1], [1]]);
    expect(allocateUnits([[0, 2], [1, 2]], 2)).toEqual([[0, 2], [1, 2]]);
    expect(allocateUnits([[0], null, [1]], 1)).toEqual([[0], null, [1]]);
    expect(allocateUnits([[3]], 2)).toEqual([null]);
  });

  it("keeps preferred units when they are still free", () => {
    expect(allocateUnits([[0, 1, 2]], 1, [[2]])).toEqual([[2]]);
    expect(allocateUnits([[0, 1]], 1, [[2]])).toEqual([[0]]);
  });

  it("finds slots of one request that overlap each other", () => {
    expect(overlappingSlots([{ start: 0, end: 10 }, { start: 10, end: 20 }, { start: 15, end: 30 }])).toEqual(new Set([2]));
  });
});

describe("tokens and codes", () => {
  it("makes references in the Crockford alphabet", () => {
    for (let index = 0; index < 200; index += 1) expect(newReference()).toMatch(REFERENCE_PATTERN);
  });

  it("stores only a hash of the manage token and compares in constant time", () => {
    const { token, hash } = newManageToken();
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(hash).toBe(hashToken(token));
    expect(hash).not.toContain(token);
    expect(manageTokenMatches(token, hash)).toBe(true);
    expect(manageTokenMatches(`${token}x`, hash)).toBe(false);
    expect(manageTokenMatches(null, hash)).toBe(false);
  });

  it("verifies check-in codes per makerspace and rejects tampering", () => {
    const code = checkInCode("ms-1", "BK-7Q2M9X");
    expect(code).toMatch(/^BK-7Q2M9X-[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(verifyCheckInCode("ms-1", code)).toBe("BK-7Q2M9X");
    expect(verifyCheckInCode("ms-1", code.toLowerCase())).toBe("BK-7Q2M9X");
    expect(verifyCheckInCode("ms-2", code)).toBeNull();
    expect(verifyCheckInCode("ms-1", code.replace("BK-7Q2M9X", "BK-7Q2M9Y"))).toBeNull();
    expect(verifyCheckInCode("ms-1", "nonsense")).toBeNull();
  });
});

describe("payment due dates", () => {
  const start = new Date("2026-11-10T10:00:00Z");
  const booked = new Date("2026-11-01T10:00:00Z");
  const rules = { ...DEFAULT_RULES, payLaterDueRule: "BEFORE_START" as const, payLaterDueHoursBeforeStart: 24, payLaterMinWindowHours: 2 };

  it("is hours before the start or days after booking, never after the start", () => {
    expect(iso(payLaterDueAt(rules, start, booked))).toBe("2026-11-09T10:00:00.000Z");
    expect(iso(payLaterDueAt({ ...rules, payLaterDueRule: "AFTER_BOOKING", payLaterDueDaysAfterBooking: 3 }, start, booked))).toBe("2026-11-04T10:00:00.000Z");
    expect(iso(payLaterDueAt({ ...rules, payLaterDueRule: "AFTER_BOOKING", payLaterDueDaysAfterBooking: 30 }, start, booked))).toBe(iso(start));
  });

  it("always leaves the minimum window", () => {
    const soon = new Date("2026-11-10T09:00:00Z");
    expect(iso(payLaterDueAt(rules, start, soon))).toBe("2026-11-10T11:00:00.000Z");
  });

  it("gives approved upfront bookings a short window, not past the start", () => {
    expect(iso(approvalDueAt({ approvalPayWithinHours: 24 }, start, booked))).toBe("2026-11-02T10:00:00.000Z");
    expect(iso(approvalDueAt({ approvalPayWithinHours: 24 }, start, new Date("2026-11-10T08:00:00Z")))).toBe(iso(start));
  });

  it("offers pay later only far enough ahead", () => {
    expect(payLaterOffered({ payLaterMinLeadHours: 4 }, start, new Date("2026-11-10T05:00:00Z"))).toBe(true);
    expect(payLaterOffered({ payLaterMinLeadHours: 4 }, start, new Date("2026-11-10T07:00:00Z"))).toBe(false);
  });
});

describe("booking status rules", () => {
  it("allow only the documented transitions", () => {
    expect(canTransition("HELD", "CONFIRMED")).toBe(true);
    expect(canTransition("REQUESTED", "DECLINED")).toBe(true);
    expect(canTransition("CONFIRMED", "REQUESTED")).toBe(false);
    expect(canTransition("CANCELLED", "CONFIRMED")).toBe(false);
    expect(BOOKING_TRANSITIONS.EXPIRED).toEqual([]);
  });

  it("block for holds and confirmations, and requests only when the rule says so", () => {
    expect(bookingBlocks("HELD", false)).toBe(true);
    expect(bookingBlocks("CONFIRMED", false)).toBe(true);
    expect(bookingBlocks("REQUESTED", true)).toBe(true);
    expect(bookingBlocks("REQUESTED", false)).toBe(false);
    expect(bookingBlocks("CANCELLED", true)).toBe(false);
  });

  it("recognise the exclusion constraint however it is reported", () => {
    expect(isExclusionViolation(new Error('conflicting key value violates exclusion constraint "BookingOccurrence_no_overlap"'))).toBe(true);
    expect(isExclusionViolation(new Error("Raw query failed. Code: `23P01`"))).toBe(true);
    expect(isExclusionViolation(new Error("unique constraint"))).toBe(false);
  });
});
