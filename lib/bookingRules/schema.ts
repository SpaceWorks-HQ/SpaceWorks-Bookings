import { z } from "zod";

/**
 * Every booking rule, its validation and its default. `MakerspaceBookingSettings` has one column per key with the
 * same default (prisma/schema.prisma), and `Space.ruleOverrides` may carry any subset. Pure and client-safe.
 */

const int = (min: number, max: number) => z.number().int().min(min).max(max);
const hoursList = (max: number) =>
  z.array(int(1, max)).max(10).transform((list) => [...new Set(list)].sort((a, b) => b - a));

export const RULE_SHAPE = {
  approvalMode: z.enum(["INSTANT", "APPROVAL"]),
  /** REQUESTED bookings hold their slot until approved, declined or expired. */
  requestsBlockSlot: z.boolean(),
  requestExpiryHours: int(1, 720),
  /** After approval, PAY_NOW and DEPOSIT bookings must be paid within this many hours (then auto-cancelled). */
  approvalPayWithinHours: int(1, 720),
  minDurationMinutes: int(5, 43_200),
  maxDurationMinutes: int(5, 43_200),
  slotStepMinutes: int(5, 1440),
  leadTimeMinutes: int(0, 525_600),
  /** The latest END a booking may have, in days from now. */
  advanceWindowDays: int(1, 3650),
  bufferBeforeMinutes: int(0, 1440),
  bufferAfterMinutes: int(0, 1440),
  /** How long a checkout hold keeps the slot. */
  holdMinutes: int(5, 120),
  recurrenceMaxOccurrences: int(1, 104),
  guestBookingAllowed: z.boolean(),
  customerCancelCutoffHours: int(0, 8760),
  customerRescheduleAllowed: z.boolean(),
  customerRescheduleCutoffHours: int(0, 8760),
  selfCheckInEnabled: z.boolean(),
  selfCheckInOpensMinutesBefore: int(0, 1440),
  selfCheckInClosesMinutesAfter: int(0, 1440),
  autoNoShow: z.boolean(),
  noShowGraceMinutes: int(0, 1440),
  noShowReleasesSlot: z.boolean(),
  noShowCharge: z.enum(["FULL", "NONE"]),
  reminderHoursBefore: hoursList(168),
  chargeMode: z.enum(["FREE", "PAY_NOW", "DEPOSIT", "PAY_LATER"]),
  /** On PAY_NOW and DEPOSIT spaces the booker may choose to pay later instead. */
  allowPayLater: z.boolean(),
  depositKind: z.enum(["PERCENT", "FIXED"]),
  depositPercentBps: int(0, 10_000),
  depositFixedMinor: int(0, 1_000_000_000),
  depositRefundable: z.boolean(),
  payLaterDueRule: z.enum(["BEFORE_START", "AFTER_BOOKING"]),
  payLaterDueHoursBeforeStart: int(0, 8760),
  payLaterDueDaysAfterBooking: int(0, 365),
  /** A pay-later due date is never sooner than this after booking. */
  payLaterMinWindowHours: int(0, 720),
  /** Closer than this to the start, pay later is not offered as a choice. */
  payLaterMinLeadHours: int(0, 8760),
  overdueAction: z.enum(["AUTO_CANCEL", "NOTIFY_STAFF"]),
  paymentReminderHoursBeforeDue: hoursList(720),
  overdueReminderHoursAfterDue: hoursList(720),
  /** A late cancel of an unpaid booking still owes the kept fee (otherwise the balance is void). */
  chargeLateCancelWhenUnpaid: z.boolean(),
} as const;

export type RuleKey = keyof typeof RULE_SHAPE;
export type BookingRules = { [K in RuleKey]: z.output<(typeof RULE_SHAPE)[K]> };
export const RULE_KEYS = Object.keys(RULE_SHAPE) as RuleKey[];

export const DEFAULT_RULES: BookingRules = {
  approvalMode: "INSTANT",
  requestsBlockSlot: true,
  requestExpiryHours: 48,
  approvalPayWithinHours: 24,
  minDurationMinutes: 30,
  maxDurationMinutes: 480,
  slotStepMinutes: 30,
  leadTimeMinutes: 60,
  advanceWindowDays: 90,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  holdMinutes: 15,
  recurrenceMaxOccurrences: 52,
  guestBookingAllowed: false,
  customerCancelCutoffHours: 0,
  customerRescheduleAllowed: true,
  customerRescheduleCutoffHours: 24,
  selfCheckInEnabled: false,
  selfCheckInOpensMinutesBefore: 15,
  selfCheckInClosesMinutesAfter: 30,
  autoNoShow: false,
  noShowGraceMinutes: 30,
  noShowReleasesSlot: true,
  noShowCharge: "FULL",
  reminderHoursBefore: [24],
  chargeMode: "FREE",
  allowPayLater: false,
  depositKind: "PERCENT",
  depositPercentBps: 5000,
  depositFixedMinor: 0,
  depositRefundable: true,
  payLaterDueRule: "BEFORE_START",
  payLaterDueHoursBeforeStart: 24,
  payLaterDueDaysAfterBooking: 7,
  payLaterMinWindowHours: 2,
  payLaterMinLeadHours: 2,
  overdueAction: "NOTIFY_STAFF",
  paymentReminderHoursBeforeDue: [24],
  overdueReminderHoursAfterDue: [24],
  chargeLateCancelWhenUnpaid: false,
};

/**
 * Money rules: changing them (for the makerspace or one space) needs `payments.settings`. Per-space tax
 * overrides (`Space.taxRateBps`, `Space.sacCode`) and refund tiers are money settings too.
 */
export const MONEY_RULE_KEYS = [
  "chargeMode",
  "allowPayLater",
  "depositKind",
  "depositPercentBps",
  "depositFixedMinor",
  "depositRefundable",
  "payLaterDueRule",
  "payLaterDueHoursBeforeStart",
  "payLaterDueDaysAfterBooking",
  "payLaterMinWindowHours",
  "payLaterMinLeadHours",
  "overdueAction",
  "paymentReminderHoursBeforeDue",
  "overdueReminderHoursAfterDue",
  "approvalPayWithinHours",
  "noShowCharge",
  "chargeLateCancelWhenUnpaid",
] as const satisfies readonly RuleKey[];

export const MONEY_SPACE_FIELDS = ["taxRateBps", "sacCode"] as const;

export function isMoneyRule(key: RuleKey): boolean {
  return (MONEY_RULE_KEYS as readonly RuleKey[]).includes(key);
}

/** A full rules object (the makerspace row). Unknown keys are dropped. */
export const rulesSchema = z.object(RULE_SHAPE);
/** A partial patch or a space's overrides. Unknown keys are refused. */
export const rulesPatchSchema = z.object(RULE_SHAPE).partial().strict();

export type RuleProblem = { key: RuleKey; message: string };

/** Rules that are only wrong together. Checked on the effective (merged) rules before any save. */
export function crossRuleProblems(rules: BookingRules): RuleProblem[] {
  const problems: RuleProblem[] = [];
  if (rules.minDurationMinutes > rules.maxDurationMinutes) problems.push({ key: "maxDurationMinutes", message: "The longest booking can't be shorter than the shortest." });
  if (rules.minDurationMinutes % rules.slotStepMinutes !== 0) problems.push({ key: "minDurationMinutes", message: "The shortest booking must be a whole number of time steps." });
  if (rules.selfCheckInEnabled && rules.selfCheckInOpensMinutesBefore + rules.selfCheckInClosesMinutesAfter === 0) problems.push({ key: "selfCheckInClosesMinutesAfter", message: "Self check-in needs a window." });
  if (rules.chargeMode === "DEPOSIT" && rules.depositKind === "PERCENT" && rules.depositPercentBps === 0) problems.push({ key: "depositPercentBps", message: "Set the deposit above zero, or charge nothing upfront." });
  if (rules.chargeMode === "DEPOSIT" && rules.depositKind === "FIXED" && rules.depositFixedMinor === 0) problems.push({ key: "depositFixedMinor", message: "Set the deposit above zero, or charge nothing upfront." });
  return problems;
}

/** Pick the rule columns out of a `MakerspaceBookingSettings` row (or any object with them). */
export function pickRules(row: Record<string, unknown> | null | undefined): BookingRules {
  if (!row) return { ...DEFAULT_RULES };
  const parsed = rulesSchema.safeParse(Object.fromEntries(RULE_KEYS.map((key) => [key, row[key]])));
  return parsed.success ? parsed.data : { ...DEFAULT_RULES };
}
