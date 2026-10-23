import type { BookingRules } from "@/lib/bookingRules/schema";
import { containingRange, overlapsAny, type TimeRange } from "@/lib/time/openIntervals";

/**
 * Whether one slot may be booked, against everything a space's schedule says. Pure. Used at hold, submit, approval
 * (approval re-checks every rule, unlike the old Django flow), reschedule and room moves. Staff with
 * `bookings.override` may override rule violations with a reason, never an overlap.
 */

export type AvailabilityRules = Pick<BookingRules, "minDurationMinutes" | "maxDurationMinutes" | "slotStepMinutes" | "leadTimeMinutes" | "advanceWindowDays" | "bufferBeforeMinutes" | "bufferAfterMinutes">;
export type BusyBlock = { unit: number; start: number; end: number };

/** A space's schedule over a window: open time (blackouts already removed), blackouts, and blocking occurrences. */
export type SpaceSchedule = {
  timeZone: string;
  units: number;
  rules: AvailabilityRules;
  open: TimeRange[];
  blackouts: TimeRange[];
  busy: BusyBlock[];
};

export type ViolationCode =
  | "INVALID_RANGE"
  | "NONEXISTENT_TIME"
  | "IN_PAST"
  | "LEAD_TIME"
  | "ADVANCE_WINDOW"
  | "TOO_SHORT"
  | "TOO_LONG"
  | "STEP"
  | "CLOSED"
  | "BLACKOUT"
  | "TOO_MANY_UNITS"
  | "OVERLAPS_SERIES"
  | "UNAVAILABLE";

export type Violation = { code: ViolationCode; message: string };

/** Codes staff may override with a reason. Overlaps, impossible times and the past never are. */
export const OVERRIDABLE_CODES: ReadonlySet<ViolationCode> = new Set(["LEAD_TIME", "ADVANCE_WINDOW", "TOO_SHORT", "TOO_LONG", "STEP", "CLOSED", "BLACKOUT"]);

const MINUTE = 60_000;

export function blockRange(start: number, end: number, rules: Pick<AvailabilityRules, "bufferBeforeMinutes" | "bufferAfterMinutes">): TimeRange {
  return { start: start - rules.bufferBeforeMinutes * MINUTE, end: end + rules.bufferAfterMinutes * MINUTE };
}

/** Units (0-based) with no busy block overlapping [start, end). */
export function freeUnits(busy: BusyBlock[], units: number, start: number, end: number): number[] {
  const taken = new Set(busy.filter((block) => block.start < end && block.end > start).map((block) => block.unit));
  return Array.from({ length: units }, (_, unit) => unit).filter((unit) => !taken.has(unit));
}

function plural(value: number, word: string) {
  return `${value} ${word}${value === 1 ? "" : "s"}`;
}

function durationText(minutes: number) {
  if (minutes % 1440 === 0) return plural(minutes / 1440, "day");
  if (minutes % 60 === 0) return plural(minutes / 60, "hour");
  return plural(minutes, "minute");
}

export type SlotRequest = { start: number; end: number; quantity: number; now: number };

/** Every reason the slot can't be booked (empty = bookable) and the free units over its block range. */
export function validateSlot(schedule: SpaceSchedule, slot: SlotRequest): { violations: Violation[]; free: number[] } {
  const { rules } = schedule;
  const violations: Violation[] = [];
  if (!(slot.end > slot.start)) return { violations: [{ code: "INVALID_RANGE", message: "The end must be after the start." }], free: [] };
  const minutes = Math.round((slot.end - slot.start) / MINUTE);
  if (slot.start < slot.now) violations.push({ code: "IN_PAST", message: "That time has already started." });
  else if (slot.start < slot.now + rules.leadTimeMinutes * MINUTE) violations.push({ code: "LEAD_TIME", message: `Book at least ${durationText(rules.leadTimeMinutes)} ahead.` });
  if (slot.end > slot.now + rules.advanceWindowDays * 1440 * MINUTE) violations.push({ code: "ADVANCE_WINDOW", message: `Bookings can end at most ${plural(rules.advanceWindowDays, "day")} ahead.` });
  if (minutes < rules.minDurationMinutes) violations.push({ code: "TOO_SHORT", message: `Book at least ${durationText(rules.minDurationMinutes)}.` });
  if (minutes > rules.maxDurationMinutes) violations.push({ code: "TOO_LONG", message: `Book at most ${durationText(rules.maxDurationMinutes)}.` });
  const block = blockRange(slot.start, slot.end, rules);
  const container = containingRange(schedule.open, block.start, block.end);
  const stepMs = rules.slotStepMinutes * MINUTE;
  if (!container) {
    if (overlapsAny(schedule.blackouts, block.start, block.end)) violations.push({ code: "BLACKOUT", message: "The space is closed then." });
    else violations.push({ code: "CLOSED", message: "That's outside opening hours (setup and cleanup time included)." });
  }
  const offGrid = container ? (block.start - container.start) % stepMs !== 0 : false;
  if (offGrid || minutes % rules.slotStepMinutes !== 0) violations.push({ code: "STEP", message: `Times go in steps of ${durationText(rules.slotStepMinutes)}.` });
  if (slot.quantity > schedule.units) violations.push({ code: "TOO_MANY_UNITS", message: `Only ${schedule.units} can be booked at once.` });
  const free = freeUnits(schedule.busy, schedule.units, block.start, block.end);
  if (free.length < slot.quantity && slot.quantity <= schedule.units) violations.push({ code: "UNAVAILABLE", message: slot.quantity > 1 && free.length > 0 ? `Only ${free.length} free at that time.` : "That time is already booked." });
  return { violations, free };
}

/** The violations that still stop a booking once staff override rules (or not). */
export function blockingViolations(violations: Violation[], override: boolean): Violation[] {
  return override ? violations.filter((violation) => !OVERRIDABLE_CODES.has(violation.code)) : violations;
}
