import { addLocalDays, compareDates, localParts, localToUtc, weekdayOf } from "@/lib/time/zoned";
import { divRoundHalfUp, type BlockRates } from "./blocks";

/**
 * Peak surcharges. A rule covers a local-time window on some weekdays; a booking pays
 * `base hourly rate × minutes inside the window × surchargeBps` for each rule it touches. The base is the hourly
 * rate, else the day rate ÷ day minutes × 60 (else the half-day rate the same way). Minutes are elapsed (real) minutes, so DST days count truly. Pure.
 */

export type PeakRuleInput = { id: string; name: string; weekdays: number[]; startMinute: number; endMinute: number; surchargeBps: number };

/** Elapsed minutes of [start, end) inside the rule's local windows. */
export function peakMinutes(start: Date, end: Date, rule: PeakRuleInput, timeZone: string): number {
  if (end <= start) return 0;
  let total = 0;
  const last = localParts(end, timeZone).date;
  for (let date = addLocalDays(localParts(start, timeZone).date, -1); compareDates(date, last) <= 0; date = addLocalDays(date, 1)) {
    if (!rule.weekdays.includes(weekdayOf(date))) continue;
    const windowStart = localToUtc(date, rule.startMinute, timeZone, "first").getTime();
    const windowEnd = localToUtc(date, rule.endMinute, timeZone, "last").getTime();
    const overlap = Math.min(end.getTime(), windowEnd) - Math.max(start.getTime(), windowStart);
    if (overlap > 0) total += overlap;
  }
  return Math.round(total / 60_000);
}

/** The surcharge for `minutes` of peak time at `bps`, from the rates the booking is priced at. Null = no base rate. */
export function peakSurcharge(rates: BlockRates, minutes: number, bps: number): number | null {
  if (minutes <= 0 || bps <= 0) return 0;
  if (rates.hourlyMinor != null) return divRoundHalfUp(BigInt(rates.hourlyMinor) * BigInt(minutes) * BigInt(bps), 60 * 10_000);
  if (rates.dayMinor != null) return divRoundHalfUp(BigInt(rates.dayMinor) * BigInt(minutes) * BigInt(bps), BigInt(rates.dayMinutes) * BigInt(10_000));
  if (rates.halfDayMinor != null) return divRoundHalfUp(BigInt(rates.halfDayMinor) * BigInt(minutes) * BigInt(bps), BigInt(rates.halfDayMinutes) * BigInt(10_000));
  return null;
}
