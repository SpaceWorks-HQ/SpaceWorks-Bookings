import type { MakerspaceStatus, TeamMember, TeamRole } from "@prisma/client";

const ALL: readonly TeamRole[] = ["BOOKINGS_MANAGER", "FRONT_DESK", "VIEWER"];

/** The top role: whoever creates a makerspace (or is invited by the platform to run it) gets it. */
export const MANAGER_ROLE = "BOOKINGS_MANAGER" satisfies TeamRole;

/**
 * What each makerspace role may do. Bookings managers run the whole makerspace: settings, payments, refunds,
 * finance, the team, spaces and bookings, and deleting it. Front desk takes bookings and records money at the
 * counter; viewers read, with customer contact details hidden. Unknown capabilities grant nothing. There is no
 * owner, space manager or treasurer role (owner decisions, 2026-10-24; docs/DECISIONS.md).
 */
export const CAPABILITIES = {
  "makerspace.view": ALL,
  "makerspace.settings": ["BOOKINGS_MANAGER"],
  "makerspace.delete": ["BOOKINGS_MANAGER"],
  "team.manage": ["BOOKINGS_MANAGER"],
  "payments.settings": ["BOOKINGS_MANAGER"],
  "spaces.manage": ["BOOKINGS_MANAGER"],
  "bookings.view": ALL,
  "bookings.manage": ["BOOKINGS_MANAGER", "FRONT_DESK"],
  "bookings.approve": ["BOOKINGS_MANAGER"],
  /** Venue cancellations (everything refunded) and booking despite the rules, with a reason. */
  "bookings.override": ["BOOKINGS_MANAGER"],
  "bookings.contact": ["BOOKINGS_MANAGER", "FRONT_DESK"],
  "payments.view": ["BOOKINGS_MANAGER", "FRONT_DESK"],
  "payments.record": ["BOOKINGS_MANAGER", "FRONT_DESK"],
  "refunds.manage": ["BOOKINGS_MANAGER"],
  "members.manage": ["BOOKINGS_MANAGER"],
  "reports.view": ALL,
  "reports.finance": ["BOOKINGS_MANAGER"],
  "integrations.manage": ["BOOKINGS_MANAGER"],
  "audit.view": ["BOOKINGS_MANAGER"],
} as const satisfies Record<string, readonly TeamRole[]>;

export type Capability = keyof typeof CAPABILITIES;

export function can(role: TeamRole | null | undefined, capability: Capability): boolean {
  return role != null && (CAPABILITIES[capability] as readonly TeamRole[]).includes(role);
}

/**
 * Capabilities a suspended or archived makerspace keeps: money already received must still be confirmed,
 * refunded and receipted, and finance records read. Everything else waits.
 */
export const SUSPENDED_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>(["makerspace.view", "bookings.view", "payments.view", "payments.record", "refunds.manage", "reports.finance", "audit.view"]);

/** Whether a makerspace in this status may use a capability at all. Before approval: none. */
export function makerspaceAllows(status: MakerspaceStatus, capability: Capability): boolean {
  if (status === "ACTIVE") return true;
  if (status === "SUSPENDED" || status === "ARCHIVED") return SUSPENDED_CAPABILITIES.has(capability);
  return false;
}

/** Seniority, only for "at least" gates and for who may change whose role. */
const roleRank: Record<TeamRole, number> = { VIEWER: 0, FRONT_DESK: 1, BOOKINGS_MANAGER: 2 };

export function hasRoleAtLeast(role: TeamRole, min: TeamRole): boolean {
  return roleRank[role] >= roleRank[min];
}

/** Bookings managers run the whole makerspace. */
export function isMakerspaceAdmin(role: TeamRole): boolean {
  return role === MANAGER_ROLE;
}

/**
 * Bookings managers manage everyone, other bookings managers included; anyone else who manages the team would
 * manage only less senior roles. The last bookings manager is protected separately (lib/teamManagers.ts).
 */
export function canManageTeamMember(actor: TeamRole, target: TeamRole): boolean {
  if (isMakerspaceAdmin(actor)) return true;
  return can(actor, "team.manage") && roleRank[target] < roleRank[actor];
}

/** Roles a person may hand out. */
export function assignableRoles(actor: TeamRole): TeamRole[] {
  return ALL.filter((role) => canManageTeamMember(actor, role));
}

export function canManageTeam(m: TeamMember | null): boolean {
  return m != null && can(m.role, "team.manage");
}

export function canDeleteMakerspace(m: TeamMember | null): boolean {
  return m != null && can(m.role, "makerspace.delete");
}

export const ROLE_LABELS: Record<TeamRole, string> = {
  BOOKINGS_MANAGER: "Bookings manager",
  FRONT_DESK: "Front desk",
  VIEWER: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<TeamRole, string> = {
  BOOKINGS_MANAGER: "The whole makerspace: settings, payments, refunds, the team, spaces, pricing, hours, bookings and deleting it.",
  FRONT_DESK: "Takes bookings, checks people in and records payments at the desk.",
  VIEWER: "Reads bookings and reports. Customer contact details are hidden.",
};

/** "a bookings manager", "a viewer": the article for a role in a sentence. */
export function roleWithArticle(role: TeamRole) {
  return `a ${ROLE_LABELS[role].toLowerCase()}`;
}

export function roleLabel(role: TeamRole) {
  return ROLE_LABELS[role];
}

/** Staff (anyone on a makerspace's team) must use an authenticator app; customers and super admins need not. */
export const STAFF_AUTHENTICATOR_SETUP = "/account/security?authenticator=required";
export const STAFF_AUTHENTICATOR_MESSAGE = "Your role in this makerspace needs an authenticator app. Set one up under Account, Security, then try again.";
