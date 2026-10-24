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
/** "Up to 4 people", "Up to 1 person per unit · 8 units", or a pointer to the makerspace. */
export function capacityText(space: { capacity: number; units: number }) {
  const people = space.capacity > 0 ? `Up to ${space.capacity} ${space.capacity === 1 ? "person" : "people"}${space.units > 1 ? " per unit" : ""}` : "Contact the makerspace for capacity";
  return `${people}${space.units > 1 ? ` · ${space.units} units` : ""}`;
}

/** Every offered rate is zero: the space is free to book. */
export function isFreeSpace(space: Rates) {
  const rates = displayRates(space);
  return rates.length > 0 && rates.every((rate) => rate.price === 0);
}

export function displayRates(space: Rates) {
  return [
    { label: "per hour", price: space.publicHourlyMinor, member: space.memberHourlyMinor },
    { label: `per ${space.halfDayMinutes / 60} hours`, price: space.publicHalfDayMinor, member: space.memberHalfDayMinor },
    { label: `per ${space.dayMinutes / 60} hours`, price: space.publicDayMinor, member: space.memberDayMinor },
  ].flatMap(({ label, price, member }) => price === null ? [] : [{ label, price, member: member !== null && member < price ? member : null }]);
}

/** Mirrors the customer rule in `checkIn`: the earliest scheduled slot that hasn't ended, inside its self check-in window. */
export function selfCheckInOpen(rules: { selfCheckInEnabled: boolean; selfCheckInOpensMinutesBefore: number; selfCheckInClosesMinutesAfter: number },
  slots: Array<{ startsAt: Date; endsAt: Date; status: string }>, now: Date) {
  if (!rules.selfCheckInEnabled) return false;
  const next = slots.filter((row) => row.status === "SCHEDULED" && row.endsAt > now).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
  if (!next) return false;
  const start = next.startsAt.getTime();
  return now.getTime() >= start - rules.selfCheckInOpensMinutesBefore * 60_000 && now.getTime() <= start + rules.selfCheckInClosesMinutesAfter * 60_000;
}
