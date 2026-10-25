import type { BookingRules } from "@/lib/bookingRules/schema";
import { invalidInput } from "./errors";

export const DAY_MS = 86_400_000;
export const MAX_BOOKING_MINUTES = 7 * 1440;
export const advanceCap = (now = new Date()) => { const date = new Date(now); date.setUTCFullYear(date.getUTCFullYear() + 2); return date; };

/** Bound expansion before opening-hours or pricing loops run. */
export function assertScheduleWindow(from: Date, to: Date) {
  const span = to.getTime() - from.getTime();
  if (!Number.isFinite(span) || span <= 0 || span > 400 * DAY_MS) throw invalidInput("Choose a schedule window of at most 400 days.");
}

export function assertBookingBounds(start: Date, durationMinutes: number, rules: BookingRules, now = new Date()) {
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0 || durationMinutes > Math.min(MAX_BOOKING_MINUTES, rules.maxDurationMinutes)) {
    throw invalidInput("Choose a booking within the maximum duration.");
  }
  if (!Number.isFinite(start.getTime()) || start.getTime() > Math.min(advanceCap(now).getTime(), now.getTime() + rules.advanceWindowDays * DAY_MS)) {
    throw invalidInput("Choose a start within the advance booking window.");
  }
}
