import type { MakerspaceReviewAction, MakerspaceStatus } from "@prisma/client";

/** Lifecycle decisions a makerspace's owners are told about by email. */
export type MakerspaceNotice = "received" | "approved" | "changes-requested" | "rejected" | "suspended" | "reactivated" | "created";

export const MAKERSPACE_NOTICES: readonly MakerspaceNotice[] = ["received", "approved", "changes-requested", "rejected", "suspended", "reactivated", "created"];

/** What a platform admin can decide about a makerspace. */
export type ReviewDecision = "approve" | "request-changes" | "reject" | "suspend" | "reactivate" | "archive";

type Transition = {
  from: readonly MakerspaceStatus[];
  to: MakerspaceStatus;
  action: MakerspaceReviewAction;
  /** Email to the owners, or null for a silent change. */
  notice: MakerspaceNotice | null;
  /** The owners are always told why a refusal, change request or suspension happened. */
  reasonRequired: boolean;
  label: string;
  /** Shown before a decision that takes access away. */
  confirm?: string;
};

export const REVIEW_DECISIONS: Record<ReviewDecision, Transition> = {
  approve: {
    from: ["PENDING_REVIEW", "CHANGES_REQUESTED"],
    to: "ACTIVE",
    action: "APPROVED",
    notice: "approved",
    reasonRequired: false,
    label: "Approve",
  },
  "request-changes": {
    from: ["PENDING_REVIEW"],
    to: "CHANGES_REQUESTED",
    action: "CHANGES_REQUESTED",
    notice: "changes-requested",
    reasonRequired: true,
    label: "Ask for changes",
  },
  reject: {
    from: ["PENDING_REVIEW", "CHANGES_REQUESTED"],
    to: "REJECTED",
    action: "REJECTED",
    notice: "rejected",
    reasonRequired: true,
    label: "Decline",
    confirm: "The applicant is told it was not approved. Its web address is held for 30 days, then released.",
  },
  suspend: {
    from: ["ACTIVE"],
    to: "SUSPENDED",
    action: "SUSPENDED",
    notice: "suspended",
    reasonRequired: true,
    label: "Suspend",
    confirm: "New bookings are paused and the team can only finish money already received.",
  },
  reactivate: {
    from: ["SUSPENDED", "ARCHIVED"],
    to: "ACTIVE",
    action: "REACTIVATED",
    notice: "reactivated",
    reasonRequired: false,
    label: "Reactivate",
  },
  archive: {
    from: ["ACTIVE", "SUSPENDED"],
    to: "ARCHIVED",
    action: "ARCHIVED",
    notice: null,
    reasonRequired: false,
    label: "Archive",
    confirm: "Archive this makerspace? It stops taking bookings; its records stay for finance.",
  },
};

export const REVIEW_DECISION_ORDER: readonly ReviewDecision[] = ["approve", "request-changes", "reject", "reactivate", "suspend", "archive"];

/** Decisions open to a platform admin for a makerspace in this status, in display order. */
export function decisionsFor(status: MakerspaceStatus): ReviewDecision[] {
  return REVIEW_DECISION_ORDER.filter((decision) => REVIEW_DECISIONS[decision].from.includes(status));
}

export function isReviewDecision(value: unknown): value is ReviewDecision {
  return typeof value === "string" && Object.hasOwn(REVIEW_DECISIONS, value);
}

/** Why an action is refused for a makerspace that isn't active. */
export const MAKERSPACE_LOCKED = "This can't be changed while the makerspace is under review, suspended or archived.";

/** Suspended and archived makerspaces keep their records for finance and members' rights. */
export function canDeleteInStatus(status: MakerspaceStatus): boolean {
  return status !== "SUSPENDED" && status !== "ARCHIVED";
}

/** Only an application sent back for changes can be edited and sent again by its team. */
export function canResubmit(status: MakerspaceStatus): boolean {
  return status === "CHANGES_REQUESTED";
}

/** How each review row reads in a timeline, for the applicant and the platform admin alike. */
export const REVIEW_ACTION_LABELS: Record<MakerspaceReviewAction, string> = {
  SUBMITTED: "Application sent",
  RESUBMITTED: "Application updated and sent again",
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
  REJECTED: "Not approved",
  SUSPENDED: "Suspended",
  REACTIVATED: "Reactivated",
  ARCHIVED: "Archived",
  CREATED: "Set up by a platform admin",
};

/** What the team sees on its application page for each status. */
export const STATUS_EXPLANATIONS: Record<MakerspaceStatus, { title: string; body: string }> = {
  PENDING_REVIEW: {
    title: "Your application is being reviewed",
    body: "A platform admin will look at it. We'll email the owners when there is a decision.",
  },
  CHANGES_REQUESTED: {
    title: "A few changes are needed",
    body: "Read the note from the platform team, update your details below and send the application again.",
  },
  ACTIVE: {
    title: "Your makerspace is approved",
    body: "Everything is open. Create membership plans and share your join link.",
  },
  REJECTED: {
    title: "Your application was not approved",
    body: "The note below says why. If you think this is a mistake, contact the platform operator.",
  },
  SUSPENDED: {
    title: "Your makerspace is suspended",
    body: "New bookings are paused and most changes wait. You can still confirm, receipt and refund payments already received.",
  },
  ARCHIVED: {
    title: "Your makerspace is archived",
    body: "It no longer takes bookings. Finance records stay available.",
  },
};
