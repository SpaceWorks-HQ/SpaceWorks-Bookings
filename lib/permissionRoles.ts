import type { MakerspaceStatus, TeamMember, TeamRole } from "@prisma/client";

const ALL: readonly TeamRole[] = ["OWNER", "SPACE_MANAGER", "BOOKINGS_MANAGER", "FRONT_DESK", "TREASURER", "VIEWER"];

/**
 * What each makerspace role may do. The owner and space managers run the whole makerspace; bookings managers
 * run spaces, pricing, availability and approvals; front desk takes bookings and money at the counter;
 * treasurers run money; viewers read, with customer contact details hidden. Unknown capabilities grant nothing.
 */
export const CAPABILITIES = {
  "makerspace.view": ALL,
  "makerspace.settings": ["OWNER", "SPACE_MANAGER"],
  "makerspace.delete": ["OWNER"],
  "team.manage": ["OWNER", "SPACE_MANAGER"],
  "payments.settings": ["OWNER", "SPACE_MANAGER"],
  "spaces.manage": ["OWNER", "SPACE_MANAGER", "BOOKINGS_MANAGER"],
  "bookings.view": ALL,
  "bookings.manage": ["OWNER", "SPACE_MANAGER", "BOOKINGS_MANAGER", "FRONT_DESK"],
  "bookings.approve": ["OWNER", "SPACE_MANAGER", "BOOKINGS_MANAGER"],
  "bookings.contact": ["OWNER", "SPACE_MANAGER", "BOOKINGS_MANAGER", "FRONT_DESK", "TREASURER"],
  "payments.view": ["OWNER", "SPACE_MANAGER", "BOOKINGS_MANAGER", "TREASURER", "FRONT_DESK"],
  "payments.record": ["OWNER", "SPACE_MANAGER", "TREASURER", "FRONT_DESK"],
  "refunds.manage": ["OWNER", "SPACE_MANAGER", "TREASURER"],
  "members.manage": ["OWNER", "SPACE_MANAGER", "BOOKINGS_MANAGER"],
  "reports.view": ALL,
  "reports.finance": ["OWNER", "SPACE_MANAGER", "TREASURER"],
  "integrations.manage": ["OWNER", "SPACE_MANAGER"],
  "audit.view": ["OWNER", "SPACE_MANAGER"],
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

/** Seniority, only for "at least" gates and for who may change whose role. Front desk and treasurer are peers. */
const roleRank: Record<TeamRole, number> = { VIEWER: 0, FRONT_DESK: 1, TREASURER: 1, BOOKINGS_MANAGER: 2, SPACE_MANAGER: 3, OWNER: 4 };

export function hasRoleAtLeast(role: TeamRole, min: TeamRole): boolean {
  return roleRank[role] >= roleRank[min];
}

/** The owner and space managers run the whole makerspace. */
export function isMakerspaceAdmin(role: TeamRole): boolean {
  return role === "OWNER" || role === "SPACE_MANAGER";
}

/** Owners manage everyone; anyone else who manages the team manages only less senior roles. */
export function canManageTeamMember(actor: TeamRole, target: TeamRole): boolean {
  if (actor === "OWNER") return true;
  return can(actor, "team.manage") && roleRank[target] < roleRank[actor];
}

/** Roles a person may hand out: below their own rank, and never owner (owners come from the platform). */
export function assignableRoles(actor: TeamRole): TeamRole[] {
  return ALL.filter((role) => role !== "OWNER" && canManageTeamMember(actor, role));
}

export function canManageTeam(m: TeamMember | null): boolean {
  return m != null && can(m.role, "team.manage");
}

export function canDeleteMakerspace(m: TeamMember | null): boolean {
  return m != null && can(m.role, "makerspace.delete");
}

export const ROLE_LABELS: Record<TeamRole, string> = {
  OWNER: "Owner",
  SPACE_MANAGER: "Space manager",
  BOOKINGS_MANAGER: "Bookings manager",
  FRONT_DESK: "Front desk",
  TREASURER: "Treasurer",
  VIEWER: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<TeamRole, string> = {
  OWNER: "Everything, including the team and deleting the makerspace.",
  SPACE_MANAGER: "The whole makerspace: settings, payments, refunds, the team and everything bookings managers do.",
  BOOKINGS_MANAGER: "Spaces, pricing, opening hours, blackouts, approvals and bookings.",
  FRONT_DESK: "Takes bookings, checks people in and records payments at the desk.",
  TREASURER: "Payments, refunds, receipts and finance reports.",
  VIEWER: "Reads bookings and reports. Customer contact details are hidden.",
};

/** "an owner", "a space manager": the article for a role in a sentence. */
export function roleWithArticle(role: TeamRole) {
  return `${role === "OWNER" ? "an" : "a"} ${ROLE_LABELS[role].toLowerCase()}`;
}

export function roleLabel(role: TeamRole) {
  return ROLE_LABELS[role];
}

/** Staff (anyone on a makerspace's team) must use an authenticator app; customers and super admins need not. */
export const STAFF_AUTHENTICATOR_SETUP = "/account/security?authenticator=required";
export const STAFF_AUTHENTICATOR_MESSAGE = "Your role in this makerspace needs an authenticator app. Set one up under Account, Security, then try again.";
