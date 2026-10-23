import { describe, expect, it } from "vitest";
import { cheapestBlocks, describePlan, divRoundHalfUp, hourlyAmount, ratesFor, type BlockRates, type SpaceRates } from "@/lib/pricing/blocks";
import { peakMinutes, peakSurcharge, type PeakRuleInput } from "@/lib/pricing/peak";

const rates = (over: Partial<BlockRates> = {}): BlockRates => ({ hourlyMinor: 50_000, halfDayMinor: 160_000, dayMinor: 280_000, halfDayMinutes: 240, dayMinutes: 480, ...over });
const space = (over: Partial<SpaceRates> = {}): SpaceRates => ({ publicHourlyMinor: 50_000, publicHalfDayMinor: 160_000, publicDayMinor: 280_000, memberHourlyMinor: 40_000, memberHalfDayMinor: null, memberDayMinor: 300_000, halfDayMinutes: 240, dayMinutes: 480, ...over });

/** A tiny deterministic generator for property-style checks. */
function random(seed: number) {
  let state = seed;
  return (max: number) => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state % max;
  };
}

describe("rounding", () => {
  it("rounds half up exactly, even past 2^53", () => {
    expect(divRoundHalfUp(5, 2)).toBe(3);
    expect(divRoundHalfUp(4, 2)).toBe(2);
    expect(divRoundHalfUp(7, 3)).toBe(2);
    expect(divRoundHalfUp(BigInt("90071992547409930"), 10)).toBe(9_007_199_254_740_993);
    expect(() => divRoundHalfUp(-1, 2)).toThrow();
  });
});

describe("hourly billing", () => {
  it("bills per started step", () => {
    expect(hourlyAmount(60_000, 70, 30)).toEqual({ minutes: 90, amountMinor: 90_000 });
    expect(hourlyAmount(60_000, 60, 30)).toEqual({ minutes: 60, amountMinor: 60_000 });
    expect(hourlyAmount(10_001, 15, 15)).toEqual({ minutes: 15, amountMinor: 2500 }); // 2500.25 → 2500
    expect(hourlyAmount(10_002, 15, 15)).toEqual({ minutes: 15, amountMinor: 2501 }); // 2500.5 → 2501
  });
});

describe("cheapestBlocks", () => {
  it("uses hourly time for short bookings", () => {
    expect(cheapestBlocks(120, rates(), 30)).toEqual({ days: 0, halfDays: 0, hourlyMinutes: 120, amountMinor: 100_000 });
  });

  it("switches to a half day once it is cheaper, even if it covers more", () => {
    expect(cheapestBlocks(210, rates(), 30)).toEqual({ days: 0, halfDays: 1, hourlyMinutes: 0, amountMinor: 160_000 });
  });

  it("uses a day block for long bookings and adds hours on top", () => {
    expect(cheapestBlocks(480, rates(), 30)!.amountMinor).toBe(280_000);
    expect(cheapestBlocks(540, rates(), 30)).toEqual({ days: 1, halfDays: 0, hourlyMinutes: 60, amountMinor: 330_000 });
    expect(cheapestBlocks(600, rates(), 30)).toEqual({ days: 1, halfDays: 0, hourlyMinutes: 120, amountMinor: 380_000 });
    // 14 h: a day + a half day + 2 h (5,400) beats two days (5,600).
    expect(cheapestBlocks(840, rates(), 30)).toEqual({ days: 1, halfDays: 1, hourlyMinutes: 120, amountMinor: 540_000 });
    expect(cheapestBlocks(900, rates(), 30)).toEqual({ days: 2, halfDays: 0, hourlyMinutes: 0, amountMinor: 560_000 });
  });

  it("covers durations with only day or half-day rates", () => {
    expect(cheapestBlocks(30, rates({ hourlyMinor: null }), 30)).toEqual({ days: 0, halfDays: 1, hourlyMinutes: 0, amountMinor: 160_000 });
    expect(cheapestBlocks(300, rates({ hourlyMinor: null, halfDayMinor: null }), 30)).toEqual({ days: 1, halfDays: 0, hourlyMinutes: 0, amountMinor: 280_000 });
    expect(cheapestBlocks(30, { hourlyMinor: null, halfDayMinor: null, dayMinor: null, halfDayMinutes: 240, dayMinutes: 480 }, 30)).toBeNull();
    expect(cheapestBlocks(0, rates(), 30)!.amountMinor).toBe(0);
  });

  it("prefers the bigger block when prices tie", () => {
    expect(cheapestBlocks(480, rates({ dayMinor: 320_000 }), 30)).toEqual({ days: 1, halfDays: 0, hourlyMinutes: 0, amountMinor: 320_000 });
  });

  it("is never dearer than any single kind of block and always covers the time (property)", () => {
    const next = random(42);
    for (let run = 0; run < 400; run += 1) {
      const r = rates({ hourlyMinor: 1000 + next(90_000), halfDayMinor: next(3) === 0 ? null : 1000 + next(400_000), dayMinor: next(3) === 0 ? null : 1000 + next(800_000), halfDayMinutes: 120 + 30 * next(6), dayMinutes: 480 + 30 * next(8) });
      const step = [15, 30, 60][next(3)];
      const minutes = step * (1 + next(80));
      const plan = cheapestBlocks(minutes, r, step)!;
      expect(plan.days * r.dayMinutes + plan.halfDays * r.halfDayMinutes + plan.hourlyMinutes).toBeGreaterThanOrEqual(minutes);
      expect(plan.amountMinor).toBeLessThanOrEqual(hourlyAmount(r.hourlyMinor!, minutes, step).amountMinor);
      if (r.dayMinor != null) expect(plan.amountMinor).toBeLessThanOrEqual(Math.ceil(minutes / r.dayMinutes) * r.dayMinor);
      if (r.halfDayMinor != null) expect(plan.amountMinor).toBeLessThanOrEqual(Math.ceil(minutes / r.halfDayMinutes) * r.halfDayMinor);
    }
  });

  it("describes plans in words", () => {
    expect(describePlan({ days: 1, halfDays: 1, hourlyMinutes: 90, amountMinor: 0 })).toBe("1 day + 1 half day + 1 h 30 min");
    expect(describePlan({ days: 2, halfDays: 0, hourlyMinutes: 30, amountMinor: 0 })).toBe("2 days + 30 min");
  });
});

describe("member rates", () => {
  it("use the member price, fall back to public, and never exceed public", () => {
    expect(ratesFor(space(), "MEMBER")).toMatchObject({ hourlyMinor: 40_000, halfDayMinor: 160_000, dayMinor: 280_000 });
    expect(ratesFor(space(), "PUBLIC")).toMatchObject({ hourlyMinor: 50_000, halfDayMinor: 160_000, dayMinor: 280_000 });
    expect(ratesFor(space({ publicDayMinor: null, memberDayMinor: 200_000 }), "MEMBER").dayMinor).toBe(200_000);
    expect(ratesFor(space({ publicDayMinor: null, memberDayMinor: 200_000 }), "PUBLIC").dayMinor).toBeNull();
  });
});

describe("peak surcharges", () => {
  const evenings: PeakRuleInput = { id: "p1", name: "Evenings", weekdays: [1, 2, 3, 4, 5], startMinute: 18 * 60, endMinute: 22 * 60, surchargeBps: 2500 };

  it("count only the minutes inside the local window on matching days", () => {
    // Monday 2 Nov 2026, 17:00–19:30 IST.
    expect(peakMinutes(new Date("2026-11-02T11:30:00Z"), new Date("2026-11-02T14:00:00Z"), evenings, "Asia/Kolkata")).toBe(90);
    // Sunday 1 Nov: not a peak day.
    expect(peakMinutes(new Date("2026-11-01T11:30:00Z"), new Date("2026-11-01T14:00:00Z"), evenings, "Asia/Kolkata")).toBe(0);
    // Across two evenings.
    expect(peakMinutes(new Date("2026-11-02T13:30:00Z"), new Date("2026-11-03T13:30:00Z"), evenings, "Asia/Kolkata")).toBe(4 * 60);
  });

  it("count real minutes on a DST night", () => {
    const night: PeakRuleInput = { id: "n", name: "Night", weekdays: [0], startMinute: 0, endMinute: 4 * 60, surchargeBps: 10_000 };
    expect(peakMinutes(new Date("2026-10-24T22:00:00Z"), new Date("2026-10-25T06:00:00Z"), night, "Europe/London")).toBe(5 * 60);
    expect(peakMinutes(new Date("2026-03-28T23:00:00Z"), new Date("2026-03-29T06:00:00Z"), night, "Europe/London")).toBe(3 * 60);
  });

  it("price from the hourly rate, else the day or half-day rate per hour", () => {
    expect(peakSurcharge(rates(), 90, 2500)).toBe(18_750);
    expect(peakSurcharge(rates({ hourlyMinor: null }), 60, 10_000)).toBe(35_000);
    expect(peakSurcharge(rates({ hourlyMinor: null, dayMinor: null }), 60, 10_000)).toBe(40_000);
    expect(peakSurcharge({ hourlyMinor: null, halfDayMinor: null, dayMinor: null, halfDayMinutes: 240, dayMinutes: 480 }, 60, 10_000)).toBeNull();
    expect(peakSurcharge(rates(), 0, 2500)).toBe(0);
  });
});
