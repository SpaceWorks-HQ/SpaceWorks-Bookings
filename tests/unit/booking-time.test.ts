import { describe, expect, it } from "vitest";
import { blackoutRanges, mergeRanges, openIntervals, subtractRanges, type WeeklyHours } from "@/lib/time/openIntervals";
import { addLocalDays, dateKey, daysBetween, localParts, localToUtc, offsetMinutesAt, parseDateKey, resolveLocal, startOfLocalDay, weekdayOf } from "@/lib/time/zoned";

const KOLKATA = "Asia/Kolkata";
const LONDON = "Europe/London";
const d = (value: string) => parseDateKey(value)!;
const iso = (ms: number | Date) => new Date(ms).toISOString();
const HOUR = 3_600_000;

describe("local time in Asia/Kolkata (no DST, +05:30)", () => {
  it("converts both ways", () => {
    expect(iso(localToUtc(d("2026-11-02"), 10 * 60, KOLKATA))).toBe("2026-11-02T04:30:00.000Z");
    expect(localParts(new Date("2026-11-02T04:30:00Z"), KOLKATA)).toEqual({ date: d("2026-11-02"), minute: 600, weekday: 1 });
    expect(offsetMinutesAt(Date.parse("2026-06-01T00:00:00Z"), KOLKATA)).toBe(330);
  });

  it("treats 24:00 as the next day's midnight", () => {
    expect(iso(localToUtc(d("2026-11-02"), 1440, KOLKATA))).toBe("2026-11-02T18:30:00.000Z");
    expect(iso(startOfLocalDay(d("2026-11-03"), KOLKATA))).toBe("2026-11-02T18:30:00.000Z");
  });

  it("never reports a fold", () => {
    for (let minute = 0; minute < 1440; minute += 30) expect(resolveLocal(d("2026-03-29"), minute, KOLKATA).kind).toBe("exact");
  });
});

describe("local time in Europe/London across DST", () => {
  it("reports the spring gap and shifts it forward", () => {
    const gap = resolveLocal(d("2026-03-29"), 90, LONDON);
    expect(gap.kind).toBe("nonexistent");
    expect(iso(gap.instant)).toBe("2026-03-29T01:30:00.000Z"); // 02:30 BST
    expect(resolveLocal(d("2026-03-29"), 60, LONDON).kind).toBe("nonexistent");
    expect(iso(localToUtc(d("2026-03-29"), 180, LONDON))).toBe("2026-03-29T02:00:00.000Z");
  });

  it("takes the first or last of an autumn time that happens twice", () => {
    expect(resolveLocal(d("2026-10-25"), 90, LONDON, "first")).toEqual({ instant: new Date("2026-10-25T00:30:00Z"), kind: "ambiguous" });
    expect(resolveLocal(d("2026-10-25"), 90, LONDON, "last")).toEqual({ instant: new Date("2026-10-25T01:30:00Z"), kind: "ambiguous" });
  });

  it("knows the offset either side", () => {
    expect(offsetMinutesAt(Date.parse("2026-01-10T12:00:00Z"), LONDON)).toBe(0);
    expect(offsetMinutesAt(Date.parse("2026-07-10T12:00:00Z"), LONDON)).toBe(60);
  });
});

describe("calendar dates", () => {
  it("adds days, counts days and names weekdays", () => {
    expect(dateKey(addLocalDays(d("2026-12-31"), 1))).toBe("2027-01-01");
    expect(daysBetween(d("2026-02-27"), d("2026-03-02"))).toBe(3);
    expect(weekdayOf(d("2026-11-01"))).toBe(0);
  });

  it("rejects impossible dates", () => {
    expect(parseDateKey("2026-02-30")).toBeNull();
    expect(parseDateKey("26-2-3")).toBeNull();
  });
});

describe("range maths", () => {
  it("merges overlapping and touching ranges", () => {
    expect(mergeRanges([{ start: 5, end: 8 }, { start: 0, end: 5 }, { start: 9, end: 9 }, { start: 7, end: 12 }])).toEqual([{ start: 0, end: 12 }]);
  });

  it("subtracts holes", () => {
    expect(subtractRanges([{ start: 0, end: 10 }], [{ start: 2, end: 3 }, { start: 8, end: 20 }])).toEqual([{ start: 0, end: 2 }, { start: 3, end: 8 }]);
    expect(subtractRanges([{ start: 0, end: 10 }], [{ start: -5, end: 50 }])).toEqual([]);
  });
});

describe("openIntervals", () => {
  const weekdays: WeeklyHours[] = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, openMinute: 9 * 60, closeMinute: 18 * 60 }));
  const base = { timeZone: KOLKATA, exceptions: [], blackouts: [] };

  it("is open all day every day with no weekly rows", () => {
    expect(openIntervals({ ...base, from: d("2026-11-02"), to: d("2026-11-03"), weekly: [] })).toEqual([{ start: Date.parse("2026-11-01T18:30:00Z"), end: Date.parse("2026-11-03T18:30:00Z") }]);
  });

  it("uses weekday rows and skips closed days", () => {
    const ranges = openIntervals({ ...base, from: d("2026-11-06"), to: d("2026-11-09"), weekly: weekdays });
    expect(ranges.map((range) => [iso(range.start), iso(range.end)])).toEqual([
      ["2026-11-06T03:30:00.000Z", "2026-11-06T12:30:00.000Z"],
      ["2026-11-09T03:30:00.000Z", "2026-11-09T12:30:00.000Z"],
    ]);
  });

  it("merges a late close with the next early opening so bookings can cross midnight", () => {
    const night: WeeklyHours[] = [{ weekday: 5, openMinute: 20 * 60, closeMinute: 1440 }, { weekday: 6, openMinute: 0, closeMinute: 4 * 60 }];
    expect(openIntervals({ ...base, from: d("2026-11-06"), to: d("2026-11-07"), weekly: night })).toEqual([{ start: Date.parse("2026-11-06T14:30:00Z"), end: Date.parse("2026-11-06T22:30:00Z") }]);
  });

  it("lets an exception close a day or replace its hours", () => {
    const exceptions = [
      { date: "2026-11-09", closed: true, intervals: [] },
      { date: "2026-11-10", closed: false, intervals: [{ openMinute: 12 * 60, closeMinute: 14 * 60 }] },
    ];
    const ranges = openIntervals({ ...base, exceptions, from: d("2026-11-09"), to: d("2026-11-10"), weekly: weekdays });
    expect(ranges).toEqual([{ start: Date.parse("2026-11-10T06:30:00Z"), end: Date.parse("2026-11-10T08:30:00Z") }]);
  });

  it("removes full-day and timed blackouts", () => {
    const blackouts = [
      { kind: "DAYS" as const, startDate: "2026-11-10", endDate: "2026-11-11" },
      { kind: "TIMED" as const, startsAt: new Date("2026-11-12T05:30:00Z"), endsAt: new Date("2026-11-12T06:30:00Z") },
    ];
    const ranges = openIntervals({ ...base, blackouts, from: d("2026-11-09"), to: d("2026-11-12"), weekly: weekdays });
    expect(ranges.map((range) => [iso(range.start), iso(range.end)])).toEqual([
      ["2026-11-09T03:30:00.000Z", "2026-11-09T12:30:00.000Z"],
      ["2026-11-12T03:30:00.000Z", "2026-11-12T05:30:00.000Z"],
      ["2026-11-12T06:30:00.000Z", "2026-11-12T12:30:00.000Z"],
    ]);
    expect(blackoutRanges([{ kind: "DAYS", startDate: "2026-11-10", endDate: "2026-11-10" }], KOLKATA)).toEqual([{ start: Date.parse("2026-11-09T18:30:00Z"), end: Date.parse("2026-11-10T18:30:00Z") }]);
  });

  it("gives the true length of DST days in London", () => {
    const allDay = (date: string) => openIntervals({ timeZone: LONDON, exceptions: [], blackouts: [], weekly: [], from: d(date), to: d(date) })[0];
    const spring = allDay("2026-03-29");
    const autumn = allDay("2026-10-25");
    expect((spring.end - spring.start) / HOUR).toBe(23);
    expect((autumn.end - autumn.start) / HOUR).toBe(25);
  });

  it("opens at the first and closes at the last of an ambiguous autumn hour", () => {
    const weekly: WeeklyHours[] = [{ weekday: 0, openMinute: 90, closeMinute: 90 + 1 }];
    const [range] = openIntervals({ timeZone: LONDON, exceptions: [], blackouts: [], weekly, from: d("2026-10-25"), to: d("2026-10-25") });
    expect(iso(range.start)).toBe("2026-10-25T00:30:00.000Z");
    expect(iso(range.end)).toBe("2026-10-25T01:31:00.000Z");
  });
});
