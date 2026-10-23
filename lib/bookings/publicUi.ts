import type { Quote } from "@/lib/pricing/quote";
import type { SlotConflict } from "./errors";
import { addLocalDays, dateKey, localParts, parseDateKey, startOfLocalDay } from "@/lib/time/zoned";

export function bookingDate(now: Date, zone: string) { return dateKey(localParts(now, zone).date); }

export function navigateBookingDate(day: string, offset: number) {
  const date = parseDateKey(day);
  if (!date) throw new Error("Choose a valid date.");
  return dateKey(addLocalDays(date, offset));
}

export function bookingDayWindow(day: string, zone: string) {
  const date = parseDateKey(day);
  if (!date) throw new Error("Choose a valid date.");
  return { start: startOfLocalDay(date, zone), end: startOfLocalDay(addLocalDays(date, 1), zone) };
}

export function durationChoices(min: number, max: number, step: number) {
  const result: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max; value += step) result.push(value);
  return result;
}

export function conflictDates(conflicts: SlotConflict[], zone: string) {
  return conflicts.map((conflict) => ({ date: bookingDate(new Date(conflict.start), zone), reasons: conflict.violations.map((item) => item.message) }));
}

export function quoteDisplay(quote: Pick<Quote, "rateKinds" | "lines" | "subtotalMinor" | "taxMinor" | "totalMinor">) {
  return { lines: quote.lines.map((line) => ({ description: line.description, detail: line.detail, amountMinor: line.amountMinor })),
    subtotalMinor: quote.subtotalMinor, taxMinor: quote.taxMinor, totalMinor: quote.totalMinor,
    memberLabel: quote.rateKinds.every((kind) => kind === "MEMBER") ? "Member rate applied" : quote.rateKinds.includes("MEMBER") ? "Member rate applied to eligible dates" : null };
}

type Rates = { publicHourlyMinor: number | null; publicHalfDayMinor: number | null; publicDayMinor: number | null;
  memberHourlyMinor: number | null; memberHalfDayMinor: number | null; memberDayMinor: number | null; halfDayMinutes: number; dayMinutes: number };
export function displayRates(space: Rates) {
  return [
    { label: "per hour", price: space.publicHourlyMinor, member: space.memberHourlyMinor },
    { label: `per ${space.halfDayMinutes / 60} hours`, price: space.publicHalfDayMinor, member: space.memberHalfDayMinor },
    { label: `per ${space.dayMinutes / 60} hours`, price: space.publicDayMinor, member: space.memberDayMinor },
  ].flatMap(({ label, price, member }) => price === null ? [] : [{ label, price, member: member !== null && member < price ? member : null }]);
}
