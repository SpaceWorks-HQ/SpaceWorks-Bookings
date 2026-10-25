import type { TeamRole } from "@prisma/client";

/** Client-safe row for the team list. `email` is present only for bookings manager viewers. */
export type TeamMemberRow = {
  id: string;
  userId: string;
  name: string | null;
  email?: string | null;
  role: TeamRole;
  joinedLabel: string;
  isYou: boolean;
};

export type TeamFilter = "everyone" | "admins" | "others";

export type RoleCounts = Record<TeamRole, number>;

export { ROLE_LABELS } from "@/lib/permissionRoles";
import { isMakerspaceAdmin } from "@/lib/permissionRoles";

const ROLE_ORDER: TeamRole[] = ["BOOKINGS_MANAGER", "FRONT_DESK", "VIEWER", "TECHNICIAN"];

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

const ROLE_NOUNS: Record<TeamRole, [string, string]> = {
  BOOKINGS_MANAGER: ["bookings manager", "bookings managers"],
  FRONT_DESK: ["front desk", "front desk"],
  VIEWER: ["viewer", "viewers"],
  TECHNICIAN: ["technician", "technicians"],
};

/** "2 bookings managers · 1 front desk · 3 viewers", skipping roles nobody holds. */
export function roleBreakdown(counts: RoleCounts) {
  const parts = ROLE_ORDER.map((role) => (counts[role] ? plural(counts[role], ...ROLE_NOUNS[role]) : null)).filter(Boolean);
  return parts.length ? parts.join(" · ") : "No one yet";
}

/**
 * One dot per person, ordered by seniority (bookings managers first, viewers last). Above `cap` people the
 * dots are shared out proportionally, keeping at least one dot for every role
 * someone holds.
 */
export function roleDots(counts: RoleCounts, cap = 24): TeamRole[] {
  const total = ROLE_ORDER.reduce((sum, role) => sum + counts[role], 0);
  if (total === 0) return [];
  const slots = Math.min(total, cap);
  const allocation = ROLE_ORDER.map((role) => (counts[role] > 0 ? Math.max(1, Math.round((counts[role] / total) * slots)) : 0));
  // Trim or pad the largest group so the total matches the slot count.
  let diff = allocation.reduce((sum, n) => sum + n, 0) - slots;
  while (diff !== 0) {
    const largest = allocation.indexOf(Math.max(...allocation));
    allocation[largest] += diff > 0 ? -1 : 1;
    diff += diff > 0 ? -1 : 1;
  }
  return ROLE_ORDER.flatMap((role, index) => Array.from({ length: allocation[index] }, () => role));
}

export function matchesFilter(role: TeamRole, filter: TeamFilter) {
  if (filter === "admins") return isMakerspaceAdmin(role);
  if (filter === "others") return !isMakerspaceAdmin(role);
  return true;
}

/** Case-insensitive match on name, and on email only when the viewer was sent one. */
export function matchesSearch(row: Pick<TeamMemberRow, "name" | "email">, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (row.name?.toLowerCase().includes(needle)) return true;
  return Boolean(row.email && row.email.toLowerCase().includes(needle));
}

export function filterTeam(rows: TeamMemberRow[], filter: TeamFilter, query: string) {
  return rows.filter((row) => matchesFilter(row.role, filter) && matchesSearch(row, query));
}

export function firstName(name: string | null | undefined) {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first || null;
}
