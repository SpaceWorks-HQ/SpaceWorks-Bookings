/**
 * Member-level reports for the portal (P8) and the member page: C1 membership and C2 history. Pure and
 * client-safe; lib/reports/memberSource.ts loads the rows. Signatures: docs/REPORTS.md "C1 and C2".
 */
import { deriveStatus, TERM_STATUS_LABELS, type TermLike, type TermStatus } from "@/lib/membership/lifecycle";
import { canRenewNow, lastValidDay, localDate, type CalendarDate } from "@/lib/membership/periods";
import type { ReportEvent } from "./dataset";

export type MemberTermRow = TermLike & { planId: string; kind: "NEW" | "RENEWAL" | "REINSTATEMENT" };
export type MemberPlanInfo = { id: string; name: string; renewalWindowDays: number };

export type MembershipCard = {
  planId: string;
  planName: string;
  status: TermStatus | "NONE";
  statusLabel: string;
  /** Last valid day of the current term, null for lifetime or no term. */
  validUntil: CalendarDate | null;
  /** Whole days until the current term ends (negative once it has ended). */
  daysToEnd: number | null;
  /** Inside the renewal window or grace, with nothing renewing it yet. */
  canRenew: boolean;
  /** A paid early renewal waiting to start. */
  renewalStartsOn: CalendarDate | null;
  /** First day the member ever held this plan. */
  memberSince: CalendarDate | null;
  /** Number of terms held (activated) on this plan. */
  termsHeld: number;
};

const HELD = new Set<TermStatus>(["UPCOMING", "ACTIVE", "GRACE", "ENDED", "LAPSED", "REVOKED"]);

/** C1: the member's standing on each plan they have ever had a term on, current plans first. */
export function memberMembership(terms: MemberTermRow[], plans: MemberPlanInfo[], now: Date, timezone: string): MembershipCard[] {
  const byPlan = new Map<string, MemberTermRow[]>();
  for (const term of terms) byPlan.set(term.planId, [...(byPlan.get(term.planId) ?? []), term]);
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const cards = [...byPlan.entries()].map(([planId, chain]) => {
    const derived = deriveStatus(chain, now);
    const plan = planById.get(planId);
    const current = derived.current;
    const held = chain.filter((term) => HELD.has(term.status) && term.startsAt);
    const first = held.reduce<Date | null>((min, term) => (!min || term.startsAt! < min ? term.startsAt! : min), null);
    const live = derived.status === "ACTIVE" || derived.status === "GRACE";
    return {
      planId,
      planName: plan?.name ?? "Plan",
      status: derived.status,
      statusLabel: TERM_STATUS_LABELS[derived.status],
      validUntil: current?.endsAt ? lastValidDay(current.endsAt, timezone) : null,
      daysToEnd: current?.endsAt ? Math.ceil((current.endsAt.getTime() - now.getTime()) / 86_400_000) : null,
      canRenew: Boolean(live && !derived.upcoming && current?.endsAt && plan && canRenewNow(current.endsAt, current.graceUntil, plan.renewalWindowDays, now)),
      renewalStartsOn: derived.upcoming?.startsAt ? localDate(derived.upcoming.startsAt, timezone) : null,
      memberSince: first ? localDate(first, timezone) : null,
      termsHeld: held.length,
    };
  });
  const rank = (status: MembershipCard["status"]) => (status === "ACTIVE" ? 0 : status === "GRACE" ? 1 : status === "UPCOMING" ? 2 : status.startsWith("PENDING") ? 3 : 4);
  return cards.sort((a, b) => rank(a.status) - rank(b.status) || a.planName.localeCompare(b.planName));
}

export type HistoryEntry = { at: Date; termId: string; planName: string; from: TermStatus | null; to: TermStatus; label: string; cause: string };

const CAUSE_LABELS: Record<string, string> = {
  applied: "Applied",
  "renewal-started": "Started a renewal",
  approved: "Approved",
  paid: "Payment received",
  "free-plan": "Joined",
  "activated-before-payment": "Started (payment to follow)",
  renewed: "Renewed",
  reject: "Application declined",
  cancel: "Cancelled",
  revoke: "Membership revoked",
  reinstated: "Membership reinstated",
  extended: "End date changed",
};

/** Words for one status change, from its cause, falling back to the new status. */
export function describeChange(event: Pick<ReportEvent, "to" | "cause">): string {
  if (event.cause === "sweep") {
    if (event.to === "ACTIVE") return "Membership started";
    if (event.to === "GRACE") return "Membership ended; grace period began";
    if (event.to === "LAPSED") return "Membership lapsed";
    if (event.to === "EXPIRED") return "Payment window closed";
    if (event.to === "ENDED") return "Renewed";
  }
  return CAUSE_LABELS[event.cause] ?? TERM_STATUS_LABELS[event.to];
}

/** C2: every status change on the member's terms, newest first. */
export function memberHistory(terms: Array<Pick<MemberTermRow, "id" | "planId">>, events: ReportEvent[], plans: Array<Pick<MemberPlanInfo, "id" | "name">>): HistoryEntry[] {
  const planOfTerm = new Map(terms.map((term) => [term.id, term.planId]));
  const planName = new Map(plans.map((plan) => [plan.id, plan.name]));
  return events
    .filter((event) => planOfTerm.has(event.termId))
    .map((event) => ({ at: event.effectiveAt, termId: event.termId, planName: planName.get(planOfTerm.get(event.termId)!) ?? "Plan", from: event.from, to: event.to, label: describeChange(event), cause: event.cause }))
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}
