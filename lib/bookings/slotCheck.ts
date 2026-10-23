import { blockRange, blockingViolations, freeUnits, OVERRIDABLE_CODES, validateSlot, type SpaceSchedule, type Violation } from "@/lib/availability/validate";
import { staffCan, type Actor } from "./actor";
import { BookingError, forbidden, type SlotConflict } from "./errors";
import { allocateUnits, overlappingSlots } from "./units";

/**
 * Check planned slots against a schedule and allocate units. Shared by hold, approval, reschedule and room moves so
 * every path checks exactly the same rules. Pure apart from the schedule the caller loaded under the space lock.
 */

export type PlannedSlot = { start: Date; end: Date; nonexistent?: boolean; preferUnits?: number[] };
export type CheckedSlots = { conflicts: SlotConflict[]; allocations: Array<number[] | null>; overridden: Violation[] };

/** Whether this actor overrides rules on this call: staff with `bookings.override` who gave a reason. */
export function overrideRequested(actor: Actor, reason: string | null | undefined): boolean {
  const given = Boolean(reason?.trim());
  if (given && !staffCan(actor, "bookings.override")) throw forbidden("Only managers can override booking rules.");
  return given;
}

export function checkSlots(schedule: SpaceSchedule, slots: PlannedSlot[], quantity: number, now: Date, override: boolean): CheckedSlots {
  const clashes = overlappingSlots(slots.map((slot) => blockRange(slot.start.getTime(), slot.end.getTime(), schedule.rules)));
  const overridden: Violation[] = [];
  const conflicts: SlotConflict[] = [];
  const free: Array<number[] | null> = slots.map((slot, slotIndex) => {
    const result = validateSlot(schedule, { start: slot.start.getTime(), end: slot.end.getTime(), quantity, now: now.getTime() });
    const violations = [...result.violations];
    if (slot.nonexistent) violations.unshift({ code: "NONEXISTENT_TIME", message: "That time doesn't exist on this date (the clocks change)." });
    if (clashes.has(slotIndex)) violations.push({ code: "OVERLAPS_SERIES", message: "This overlaps another booking in the same series." });
    const blocking = blockingViolations(violations, override);
    overridden.push(...violations.filter((violation) => override && OVERRIDABLE_CODES.has(violation.code)));
    if (blocking.length) {
      conflicts.push({ slotIndex, start: slot.start, end: slot.end, violations: blocking });
      return null;
    }
    const block = blockRange(slot.start.getTime(), slot.end.getTime(), schedule.rules);
    return freeUnits(schedule.busy, schedule.units, block.start, block.end);
  });
  return { conflicts, allocations: allocateUnits(free, quantity, slots.map((slot) => slot.preferUnits ?? null)), overridden };
}

/** Refuse when any slot conflicts. */
export function assertNoConflicts(checked: CheckedSlots): void {
  if (checked.conflicts.length === 0) return;
  const first = checked.conflicts[0].violations[0];
  const message = checked.conflicts.length === 1 ? first.message : `${checked.conflicts.length} of the times can't be booked.`;
  throw new BookingError("UNAVAILABLE", message, checked.conflicts);
}
