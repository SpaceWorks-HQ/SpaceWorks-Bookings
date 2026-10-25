import type { TimeRange } from "@/lib/time/openIntervals";
import { blockRange, freeUnits, validateSlot, type SpaceSchedule } from "./validate";

/**
 * What can be booked: free start times for a duration, and free ranges for a calendar. Pure. Start times sit on a
 * grid of `slotStepMinutes` from the start of each open range (after the setup buffer), so they follow opening
 * hours rather than the clock.
 */

const MINUTE = 60_000;
export const MAX_START_TIMES = 2000;

export type StartTimesQuery = { from: number; to: number; durationMinutes: number; quantity: number; now: number };
export type FreeStart = { start: number; end: number; freeUnits: number };

export function freeStartTimes(schedule: SpaceSchedule, query: StartTimesQuery): FreeStart[] {
  const { rules } = schedule;
  const step = rules.slotStepMinutes * MINUTE;
  const duration = query.durationMinutes * MINUTE;
  const result: FreeStart[] = [];
  for (const range of schedule.open) {
    for (let start = range.start + rules.bufferBeforeMinutes * MINUTE; ; start += step) {
      const end = start + duration;
      if (blockRange(start, end, rules).end > range.end || start >= query.to) break;
      if (start < query.from) continue;
      const { violations, free } = validateSlot(schedule, { start, end, quantity: query.quantity, now: query.now });
      if (violations.length === 0) result.push({ start, end, freeUnits: free.length });
      if (result.length >= MAX_START_TIMES) return result;
    }
  }
  return result;
}

export type FreeRange = TimeRange & { freeUnits: number };
export type FreeRangesQuery = { from: number; to: number; quantity: number; now: number };

/**
 * Open time with at least `quantity` free units, split where the number of free units changes. Clipped to the lead
 * time and the advance window. Existing bookings' buffers count as busy.
 */
export function freeRanges(schedule: SpaceSchedule, query: FreeRangesQuery): FreeRange[] {
  const { rules } = schedule;
  const earliest = Math.max(query.from, query.now + rules.leadTimeMinutes * MINUTE);
  const latest = Math.min(query.to, query.now + rules.advanceWindowDays * 1440 * MINUTE);
  const result: FreeRange[] = [];
  for (const range of schedule.open) {
    const start = Math.max(range.start, earliest);
    const end = Math.min(range.end, latest);
    if (end <= start) continue;
    const cuts = new Set([start, end]);
    for (const block of schedule.busy) {
      if (block.start > start && block.start < end) cuts.add(block.start);
      if (block.end > start && block.end < end) cuts.add(block.end);
    }
    const points = [...cuts].sort((a, b) => a - b);
    for (let index = 0; index < points.length - 1; index += 1) {
      const [segmentStart, segmentEnd] = [points[index], points[index + 1]];
      const free = freeUnits(schedule.busy, schedule.units, segmentStart, segmentEnd).length;
      if (free < query.quantity) continue;
      const last = result[result.length - 1];
      if (last && last.end === segmentStart && last.freeUnits === free) last.end = segmentEnd;
      else result.push({ start: segmentStart, end: segmentEnd, freeUnits: free });
    }
  }
  return result;
}
