import type { BookingRules } from "@/lib/bookingRules/schema";

/**
 * Payment due dates. Pure.
 * - Pay later: `max(bookedAt + payLaterMinWindowHours, min(ruleDue, firstStart))`, where the rule is hours before
 *   the start or days after booking. One due date for a whole series (from its first occurrence).
 * - After an approval, PAY_NOW and DEPOSIT bookings are due within `approvalPayWithinHours`, never after the start.
 * - Pay later is offered as a choice only while the start is at least `payLaterMinLeadHours` away.
 */

const HOUR = 3_600_000;
type DueRules = Pick<BookingRules, "payLaterDueRule" | "payLaterDueHoursBeforeStart" | "payLaterDueDaysAfterBooking" | "payLaterMinWindowHours">;

export function payLaterDueAt(rules: DueRules, firstStart: Date, bookedAt: Date): Date {
  const ruleDue =
    rules.payLaterDueRule === "BEFORE_START"
      ? firstStart.getTime() - rules.payLaterDueHoursBeforeStart * HOUR
      : bookedAt.getTime() + rules.payLaterDueDaysAfterBooking * 24 * HOUR;
  return new Date(Math.max(bookedAt.getTime() + rules.payLaterMinWindowHours * HOUR, Math.min(ruleDue, firstStart.getTime())));
}

export function approvalDueAt(rules: Pick<BookingRules, "approvalPayWithinHours">, firstStart: Date, approvedAt: Date): Date {
  return new Date(Math.max(approvedAt.getTime(), Math.min(approvedAt.getTime() + rules.approvalPayWithinHours * HOUR, firstStart.getTime())));
}

export function payLaterOffered(rules: Pick<BookingRules, "payLaterMinLeadHours">, firstStart: Date, now: Date): boolean {
  return firstStart.getTime() - now.getTime() >= rules.payLaterMinLeadHours * HOUR;
}
