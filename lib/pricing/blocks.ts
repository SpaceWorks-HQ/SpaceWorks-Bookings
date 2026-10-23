import type { RateKind } from "@prisma/client";

/**
 * Space rates and the cheapest way to cover a duration with day, half-day and hourly blocks. Pure.
 * Hourly time is billed per started slot step (a 70-minute remainder on a 30-minute step bills 90 minutes).
 */

export type SpaceRates = {
  publicHourlyMinor: number | null;
  publicHalfDayMinor: number | null;
  publicDayMinor: number | null;
  memberHourlyMinor: number | null;
  memberHalfDayMinor: number | null;
  memberDayMinor: number | null;
  halfDayMinutes: number;
  dayMinutes: number;
};

export type BlockRates = { hourlyMinor: number | null; halfDayMinor: number | null; dayMinor: number | null; halfDayMinutes: number; dayMinutes: number };
export type BlockPlan = { days: number; halfDays: number; hourlyMinutes: number; amountMinor: number };

/** Round a non-negative fraction a/b half up, exactly (BigInt), as an integer. */
export function divRoundHalfUp(numerator: bigint | number, denominator: bigint | number): number {
  const n = BigInt(numerator);
  const d = BigInt(denominator);
  const [zero, two] = [BigInt(0), BigInt(2)];
  if (d <= zero || n < zero) throw new RangeError("divRoundHalfUp expects a non-negative numerator and a positive denominator");
  return Number((n * two + d) / (d * two));
}

/** The member price is the member rate, else the public one, and never above the public one. */
function memberPrice(member: number | null, publicPrice: number | null): number | null {
  if (member == null) return publicPrice;
  return publicPrice == null ? member : Math.min(member, publicPrice);
}

export function ratesFor(rates: SpaceRates, kind: RateKind): BlockRates {
  const member = kind === "MEMBER";
  return {
    hourlyMinor: member ? memberPrice(rates.memberHourlyMinor, rates.publicHourlyMinor) : rates.publicHourlyMinor,
    halfDayMinor: member ? memberPrice(rates.memberHalfDayMinor, rates.publicHalfDayMinor) : rates.publicHalfDayMinor,
    dayMinor: member ? memberPrice(rates.memberDayMinor, rates.publicDayMinor) : rates.publicDayMinor,
    halfDayMinutes: rates.halfDayMinutes,
    dayMinutes: rates.dayMinutes,
  };
}

export function hasAnyRate(rates: BlockRates): boolean {
  return rates.hourlyMinor != null || rates.halfDayMinor != null || rates.dayMinor != null;
}

/** The hourly price of `minutes`, billed in whole steps. */
export function hourlyAmount(hourlyMinor: number, minutes: number, stepMinutes: number): { minutes: number; amountMinor: number } {
  const billed = minutes <= 0 ? 0 : Math.ceil(minutes / stepMinutes) * stepMinutes;
  return { minutes: billed, amountMinor: divRoundHalfUp(BigInt(hourlyMinor) * BigInt(billed), 60) };
}

/**
 * The cheapest combination of day, half-day and hourly blocks covering `durationMinutes`. Blocks may cover more
 * than the booking (a day block can be cheaper than nine hours). Ties go to the plan that bills fewer minutes, then
 * to bigger blocks. Null when the offered rates can't cover the duration.
 */
export function cheapestBlocks(durationMinutes: number, rates: BlockRates, stepMinutes: number): BlockPlan | null {
  if (durationMinutes <= 0) return { days: 0, halfDays: 0, hourlyMinutes: 0, amountMinor: 0 };
  let best: (BlockPlan & { billed: number }) | null = null;
  const maxDays = rates.dayMinor == null ? 0 : Math.ceil(durationMinutes / rates.dayMinutes);
  for (let days = maxDays; days >= 0; days -= 1) {
    const afterDays = Math.max(0, durationMinutes - days * rates.dayMinutes);
    const maxHalves = rates.halfDayMinor == null ? 0 : Math.ceil(afterDays / rates.halfDayMinutes);
    for (let halfDays = maxHalves; halfDays >= 0; halfDays -= 1) {
      const rest = Math.max(0, afterDays - halfDays * rates.halfDayMinutes);
      if (rest > 0 && rates.hourlyMinor == null) continue;
      const hourly = rest > 0 && rates.hourlyMinor != null ? hourlyAmount(rates.hourlyMinor, rest, stepMinutes) : { minutes: 0, amountMinor: 0 };
      const amountMinor = days * (rates.dayMinor ?? 0) + halfDays * (rates.halfDayMinor ?? 0) + hourly.amountMinor;
      const billed = days * rates.dayMinutes + halfDays * rates.halfDayMinutes + hourly.minutes;
      if (!best || amountMinor < best.amountMinor || (amountMinor === best.amountMinor && billed < best.billed)) {
        best = { days, halfDays, hourlyMinutes: hourly.minutes, amountMinor, billed };
      }
    }
  }
  if (!best) return null;
  return { days: best.days, halfDays: best.halfDays, hourlyMinutes: best.hourlyMinutes, amountMinor: best.amountMinor };
}

/** "1 day + 2 h 30 min", for line details. */
export function describePlan(plan: BlockPlan): string {
  const parts: string[] = [];
  if (plan.days) parts.push(`${plan.days} ${plan.days === 1 ? "day" : "days"}`);
  if (plan.halfDays) parts.push(`${plan.halfDays} half ${plan.halfDays === 1 ? "day" : "days"}`);
  if (plan.hourlyMinutes) {
    const hours = Math.floor(plan.hourlyMinutes / 60);
    const minutes = plan.hourlyMinutes % 60;
    parts.push([hours ? `${hours} h` : "", minutes ? `${minutes} min` : ""].filter(Boolean).join(" "));
  }
  return parts.join(" + ") || "0 min";
}
