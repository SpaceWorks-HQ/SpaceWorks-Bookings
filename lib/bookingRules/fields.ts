import { DEFAULT_RULES, RULE_KEYS, isMoneyRule, type BookingRules, type RuleKey } from "./schema";

export const RULE_GROUPS: Array<{ title: string; keys: RuleKey[] }> = [
  { title: "Approval", keys: ["approvalMode", "requestsBlockSlot", "requestExpiryHours"] },
  { title: "Durations and steps", keys: ["minDurationMinutes", "maxDurationMinutes", "slotStepMinutes", "recurrenceMaxOccurrences"] },
  { title: "Lead time and window", keys: ["leadTimeMinutes", "advanceWindowDays"] },
  { title: "Buffers", keys: ["bufferBeforeMinutes", "bufferAfterMinutes"] },
  { title: "Holds", keys: ["holdMinutes"] },
  { title: "Guests", keys: ["guestBookingAllowed"] },
  { title: "Cancellation and reschedule", keys: ["customerCancelCutoffHours", "customerRescheduleAllowed", "customerRescheduleCutoffHours"] },
  { title: "Check-in and no-show", keys: ["selfCheckInEnabled", "selfCheckInOpensMinutesBefore", "selfCheckInClosesMinutesAfter", "autoNoShow", "noShowGraceMinutes", "noShowReleasesSlot"] },
  { title: "Reminders", keys: ["reminderHoursBefore"] },
  { title: "Payment defaults", keys: RULE_KEYS.filter(isMoneyRule) },
];

export const RULE_LABELS: Record<RuleKey, string> = {
  approvalMode: "Approval mode", requestsBlockSlot: "Requests reserve the slot", requestExpiryHours: "Request expiry (hours)",
  approvalPayWithinHours: "Payment deadline after approval (hours)", minDurationMinutes: "Shortest booking (minutes)",
  maxDurationMinutes: "Longest booking (minutes)", slotStepMinutes: "Time step (minutes)", recurrenceMaxOccurrences: "Maximum occurrences in a series",
  leadTimeMinutes: "Minimum notice (minutes)", advanceWindowDays: "Advance booking window (days, applies to the end)",
  bufferBeforeMinutes: "Buffer before (minutes)", bufferAfterMinutes: "Buffer after (minutes)", holdMinutes: "Checkout hold (minutes)",
  guestBookingAllowed: "Allow guest bookings", customerCancelCutoffHours: "Customer cancellation cutoff (hours)",
  customerRescheduleAllowed: "Allow customer rescheduling", customerRescheduleCutoffHours: "Customer reschedule cutoff (hours)",
  selfCheckInEnabled: "Allow self check-in", selfCheckInOpensMinutesBefore: "Check-in opens before start (minutes)",
  selfCheckInClosesMinutesAfter: "Check-in closes after start (minutes)", autoNoShow: "Automatically mark no-shows",
  noShowGraceMinutes: "No-show grace period (minutes)", noShowReleasesSlot: "No-shows release the slot", noShowCharge: "No-show charge",
  reminderHoursBefore: "Reminder hours before start (comma separated)", chargeMode: "Charge mode", allowPayLater: "Offer pay later",
  depositKind: "Deposit type", depositPercentBps: "Deposit (basis points, 100 = 1%)", depositFixedMinor: "Fixed deposit (minor units)",
  depositRefundable: "Deposit is refundable", payLaterDueRule: "Pay-later due rule", payLaterDueHoursBeforeStart: "Payment due before start (hours)",
  payLaterDueDaysAfterBooking: "Payment due after booking (days)", payLaterMinWindowHours: "Minimum payment window (hours)",
  payLaterMinLeadHours: "Minimum notice for pay later (hours)", overdueAction: "Overdue action",
  paymentReminderHoursBeforeDue: "Payment reminder hours before due (comma separated)", overdueReminderHoursAfterDue: "Overdue reminder hours after due (comma separated)",
  chargeLateCancelWhenUnpaid: "Charge late cancellation fees on unpaid bookings",
};

export const RULE_OPTIONS: Partial<Record<RuleKey, string[]>> = {
  approvalMode: ["INSTANT", "APPROVAL"], noShowCharge: ["FULL", "NONE"], chargeMode: ["FREE", "PAY_NOW", "DEPOSIT", "PAY_LATER"],
  depositKind: ["PERCENT", "FIXED"], payLaterDueRule: ["BEFORE_START", "AFTER_BOOKING"], overdueAction: ["AUTO_CANCEL", "NOTIFY_STAFF"],
};

export function ruleValue(key: RuleKey, raw: FormDataEntryValue | null): BookingRules[RuleKey] {
  const sample = DEFAULT_RULES[key];
  if (typeof sample === "boolean") return raw === "on";
  const value = String(raw ?? "").trim();
  if (Array.isArray(sample)) return value === "" ? [] : value.split(",").map((item) => Number(item.trim()));
  return typeof sample === "number" ? Number(value) : value as BookingRules[RuleKey];
}

export function ruleFormPatch(data: FormData, money: boolean, space: boolean) {
  return Object.fromEntries(RULE_KEYS.filter((key) => money || !isMoneyRule(key)).map((key) => [key,
    space && data.get(`source-${key}`) !== "space" ? null : ruleValue(key, data.get(key)),
  ]));
}
