import { describe, expect, it } from "vitest";
import { freeRanges, freeStartTimes } from "@/lib/availability/slots";
import { blockingViolations, freeUnits, validateSlot, type SpaceSchedule } from "@/lib/availability/validate";
import { openIntervals } from "@/lib/time/openIntervals";
import { parseDateKey } from "@/lib/time/zoned";

const TZ = "Asia/Kolkata";
const at = (local: string) => Date.parse(`${local}:00+05:30`);
const NOW = at("2026-11-01T12:00");
const rules = { minDurationMinutes: 60, maxDurationMinutes: 240, slotStepMinutes: 30, leadTimeMinutes: 120, advanceWindowDays: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
const weekly = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, openMinute: 9 * 60, closeMinute: 18 * 60 }));

function schedule(over: Partial<SpaceSchedule> = {}): SpaceSchedule {
  const blackouts = [{ kind: "DAYS" as const, startDate: "2026-11-04", endDate: "2026-11-04" }];
  return {
    timeZone: TZ,
    units: 1,
    rules,
    open: openIntervals({ timeZone: TZ, from: parseDateKey("2026-10-31")!, to: parseDateKey("2026-12-31")!, weekly, exceptions: [], blackouts }),
    blackouts: [{ start: at("2026-11-04T00:00"), end: at("2026-11-05T00:00") }],
    busy: [],
    ...over,
  };
}
const codes = (s: SpaceSchedule, start: string, end: string, quantity = 1, now = NOW) => validateSlot(s, { start: at(start), end: at(end), quantity, now }).violations.map((v) => v.code);

describe("validateSlot", () => {
  it("accepts a slot that keeps every rule", () => {
    expect(codes(schedule(), "2026-11-02T10:00", "2026-11-02T12:00")).toEqual([]);
  });

  it("reports each broken rule", () => {
    expect(codes(schedule(), "2026-11-01T10:00", "2026-11-01T11:00")).toEqual(["IN_PAST", "CLOSED"]);
    expect(codes(schedule(), "2026-11-02T10:00", "2026-11-02T10:30")).toEqual(["TOO_SHORT"]);
    expect(codes(schedule(), "2026-11-02T10:00", "2026-11-02T15:00")).toEqual(["TOO_LONG"]);
    expect(codes(schedule(), "2026-11-02T10:15", "2026-11-02T11:15")).toEqual(["STEP"]);
    expect(codes(schedule(), "2026-11-02T10:00", "2026-11-02T11:15")).toEqual(["STEP"]);
    expect(codes(schedule(), "2026-11-02T17:00", "2026-11-02T19:00")).toEqual(["CLOSED"]);
    expect(codes(schedule(), "2026-11-04T10:00", "2026-11-04T11:00")).toEqual(["BLACKOUT"]);
    expect(codes(schedule(), "2026-12-02T10:00", "2026-12-02T11:00")).toEqual(["ADVANCE_WINDOW"]);
    expect(codes(schedule(), "2026-11-02T10:00", "2026-11-02T09:00")).toEqual(["INVALID_RANGE"]);
    expect(codes(schedule(), "2026-11-02T10:00", "2026-11-02T11:00", 2)).toEqual(["TOO_MANY_UNITS"]);
  });

  it("applies the lead time to the start and the advance window to the end", () => {
    expect(codes(schedule(), "2026-11-02T10:00", "2026-11-02T11:00", 1, at("2026-11-02T08:30"))).toEqual(["LEAD_TIME"]);
    // Ends 30 days and 30 minutes from now: outside the window even though it starts inside.
    expect(codes(schedule({ rules: { ...rules, maxDurationMinutes: 600 } }), "2026-12-01T09:00", "2026-12-01T12:30", 1, at("2026-11-01T12:00"))).toContain("ADVANCE_WINDOW");
  });

  it("needs setup and cleanup buffers to fit inside opening hours", () => {
    const buffered = schedule({ rules: { ...rules, bufferBeforeMinutes: 30, bufferAfterMinutes: 30 } });
    expect(codes(buffered, "2026-11-02T09:00", "2026-11-02T10:00")).toEqual(["CLOSED"]);
    expect(codes(buffered, "2026-11-02T09:30", "2026-11-02T10:30")).toEqual([]);
    expect(codes(buffered, "2026-11-02T16:30", "2026-11-02T17:30")).toEqual([]);
    expect(codes(buffered, "2026-11-02T17:00", "2026-11-02T18:00")).toEqual(["CLOSED"]);
  });

  it("sees busy units, half-open: back to back is fine", () => {
    const busy = [{ unit: 0, start: at("2026-11-02T10:00"), end: at("2026-11-02T12:00") }];
    expect(codes(schedule({ busy }), "2026-11-02T11:00", "2026-11-02T13:00")).toEqual(["UNAVAILABLE"]);
    expect(codes(schedule({ busy }), "2026-11-02T12:00", "2026-11-02T13:00")).toEqual([]);
    const desks = schedule({ units: 3, busy: [...busy, { unit: 2, start: at("2026-11-02T09:00"), end: at("2026-11-02T18:00") }] });
    expect(validateSlot(desks, { start: at("2026-11-02T11:00"), end: at("2026-11-02T12:00"), quantity: 1, now: NOW }).free).toEqual([1]);
    expect(codes(desks, "2026-11-02T11:00", "2026-11-02T12:00", 2)).toEqual(["UNAVAILABLE"]);
  });

  it("lets staff override rules, never overlaps", () => {
    const busy = [{ unit: 0, start: at("2026-11-02T17:00"), end: at("2026-11-02T18:00") }];
    const { violations } = validateSlot(schedule({ busy }), { start: at("2026-11-02T17:00"), end: at("2026-11-02T19:00"), quantity: 1, now: NOW });
    expect(blockingViolations(violations, true).map((v) => v.code)).toEqual(["UNAVAILABLE"]);
    expect(blockingViolations(violations, false).map((v) => v.code)).toEqual(["CLOSED", "UNAVAILABLE"]);
  });
});

describe("freeUnits", () => {
  it("lists units with nothing overlapping", () => {
    expect(freeUnits([{ unit: 1, start: 0, end: 10 }], 3, 5, 15)).toEqual([0, 2]);
    expect(freeUnits([{ unit: 1, start: 0, end: 10 }], 3, 10, 15)).toEqual([0, 1, 2]);
  });
});

describe("freeStartTimes", () => {
  it("lists start times on the grid from opening time, skipping booked ones", () => {
    const busy = [{ unit: 0, start: at("2026-11-02T10:00"), end: at("2026-11-02T16:00") }];
    const starts = freeStartTimes(schedule({ busy }), { from: at("2026-11-02T00:00"), to: at("2026-11-03T00:00"), durationMinutes: 60, quantity: 1, now: NOW });
    expect(starts.map((slot) => new Date(slot.start).toISOString())).toEqual(["2026-11-02T03:30:00.000Z", "2026-11-02T10:30:00.000Z", "2026-11-02T11:00:00.000Z", "2026-11-02T11:30:00.000Z"]);
  });

  it("follows opening times that aren't on the hour", () => {
    const odd = schedule({ open: openIntervals({ timeZone: TZ, from: parseDateKey("2026-11-02")!, to: parseDateKey("2026-11-02")!, weekly: [{ weekday: 1, openMinute: 9 * 60 + 15, closeMinute: 11 * 60 + 15 }], exceptions: [], blackouts: [] }) });
    const starts = freeStartTimes(odd, { from: at("2026-11-02T00:00"), to: at("2026-11-03T00:00"), durationMinutes: 60, quantity: 1, now: NOW });
    expect(starts.map((slot) => new Date(slot.start).toISOString())).toEqual(["2026-11-02T03:45:00.000Z", "2026-11-02T04:15:00.000Z", "2026-11-02T04:45:00.000Z"]);
  });
});

describe("freeRanges", () => {
  it("splits open time where the number of free units changes", () => {
    const busy = [{ unit: 0, start: at("2026-11-02T10:00"), end: at("2026-11-02T12:00") }];
    const ranges = freeRanges(schedule({ units: 2, busy }), { from: at("2026-11-02T00:00"), to: at("2026-11-03T00:00"), quantity: 1, now: NOW });
    expect(ranges.map((range) => [new Date(range.start).toISOString(), new Date(range.end).toISOString(), range.freeUnits])).toEqual([
      ["2026-11-02T03:30:00.000Z", "2026-11-02T04:30:00.000Z", 2],
      ["2026-11-02T04:30:00.000Z", "2026-11-02T06:30:00.000Z", 1],
      ["2026-11-02T06:30:00.000Z", "2026-11-02T12:30:00.000Z", 2],
    ]);
    expect(freeRanges(schedule({ units: 2, busy }), { from: at("2026-11-02T00:00"), to: at("2026-11-03T00:00"), quantity: 2, now: NOW })).toHaveLength(2);
  });

  it("clips to the lead time", () => {
    const ranges = freeRanges(schedule(), { from: at("2026-11-02T00:00"), to: at("2026-11-03T00:00"), quantity: 1, now: at("2026-11-02T10:00") });
    expect(new Date(ranges[0].start).toISOString()).toBe("2026-11-02T06:30:00.000Z");
  });
});
