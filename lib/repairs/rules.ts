import type { IssueSeverity, IssueStatus, RepairRequestStatus } from "@prisma/client";

/**
 * Repairs (pure): who may move an issue where, what a payout status is, and the small formats. An issue goes
 * REPORTED → ASSIGNED (a technician accepted, or a manager assigned one) → FIXED (the technician recorded the work)
 * → CLOSED (a bookings manager verified it). A manager may reopen a FIXED or CLOSED issue back to ASSIGNED.
 * Client-safe: no server imports.
 */

export const ISSUE_SEVERITIES: readonly IssueSeverity[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
export const SEVERITY_LABELS: Record<IssueSeverity, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", URGENT: "Urgent" };
export const STATUS_LABELS: Record<IssueStatus, string> = { REPORTED: "Reported", ASSIGNED: "Assigned", FIXED: "Fixed, to verify", CLOSED: "Closed" };
export const REQUEST_LABELS: Record<RepairRequestStatus, string> = { SENT: "Asked", ACCEPTED: "Accepted", DECLINED: "Declined", EXPIRED: "Expired", CLOSED: "Taken by someone else" };

/** How long a technician has to answer a request, and how long an accepted link keeps working. */
export const REQUEST_ANSWER_DAYS = 3;
export const LINK_DAYS = 14;
export const DAY_MS = 86_400_000;

export type IssueAction = "assign" | "fix" | "close" | "reopen" | "request";

/** Whether an action is possible in a status (who may do it is checked separately). */
export function canMove(status: IssueStatus, action: IssueAction): boolean {
  switch (action) {
    case "request": return status === "REPORTED";
    case "assign": return status === "REPORTED" || status === "ASSIGNED";
    case "fix": return status === "ASSIGNED";
    case "close": return status === "FIXED";
    case "reopen": return status === "FIXED" || status === "CLOSED";
  }
}

export type PayoutState = "NOTHING_ASKED" | "TO_APPROVE" | "UNPAID" | "PARTLY_PAID" | "PAID";
export const PAYOUT_LABELS: Record<PayoutState, string> = { NOTHING_ASKED: "Nothing asked", TO_APPROVE: "To approve", UNPAID: "Unpaid", PARTLY_PAID: "Partly paid", PAID: "Paid" };

/** Where the money for a repair stands: approved amount against what has been paid out. */
export function payoutState(input: { amountAskedMinor: number | null; approvedMinor: number | null; paidMinor: number }): PayoutState {
  if (input.approvedMinor === null) return input.amountAskedMinor ? "TO_APPROVE" : "NOTHING_ASKED";
  if (input.paidMinor <= 0) return input.approvedMinor === 0 ? "PAID" : "UNPAID";
  return input.paidMinor >= input.approvedMinor ? "PAID" : "PARTLY_PAID";
}

/** Skill tags: trimmed, lower case, unique, at most 12 of 30 characters each. */
export function cleanSkills(values: string[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const tag = value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 30);
    if (tag) seen.add(tag);
  }
  return [...seen].slice(0, 12);
}

export type TechnicianContact = { kind: "STAFF" | "EXTERNAL"; email: string | null; whatsapp: string | null; telegramChatId: string | null };

/** The channels a request goes out on: email always (when there is an address), chat where both sides are set up. */
export function requestChannels(technician: TechnicianContact, available: { whatsapp: boolean; telegram: boolean }): string[] {
  const channels: string[] = [];
  if (technician.kind === "STAFF") channels.push("INBOX");
  if (technician.email) channels.push("EMAIL");
  if (available.whatsapp && technician.whatsapp) channels.push("WHATSAPP");
  if (available.telegram && technician.telegramChatId) channels.push("TELEGRAM");
  return channels;
}
