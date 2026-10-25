import { describe, expect, it } from "vitest";
import { TeamRole } from "@prisma/client";
import { assignableRoles, can, canManageTeamMember, CAPABILITIES, hasRoleAtLeast, isMakerspaceAdmin, MANAGER_ROLE, ROLE_DESCRIPTIONS, ROLE_LABELS, roleWithArticle } from "@/lib/permissionRoles";

const ROLES: TeamRole[] = ["BOOKINGS_MANAGER", "FRONT_DESK", "VIEWER", "TECHNICIAN"];
const DESK: TeamRole[] = ["BOOKINGS_MANAGER", "FRONT_DESK", "VIEWER"];
const holders = (capability: keyof typeof CAPABILITIES) => ROLES.filter((role) => can(role, capability));

describe("bookings roles", () => {
  it("has no owner, space manager or treasurer role; the bookings manager is the top role (owner decisions, 2026-10-24)", () => {
    expect(Object.values(TeamRole)).toEqual(ROLES);
    expect(MANAGER_ROLE).toBe("BOOKINGS_MANAGER");
  });

  it("labels and describes every role", () => {
    expect(ROLES.map((role) => ROLE_LABELS[role])).toEqual(["Bookings manager", "Front desk", "Viewer", "Technician"]);
    for (const role of ROLES) expect(ROLE_DESCRIPTIONS[role].length).toBeGreaterThan(10);
    expect(roleWithArticle("BOOKINGS_MANAGER")).toBe("a bookings manager");
    expect(roleWithArticle("FRONT_DESK")).toBe("a front desk");
  });

  it("gives bookings managers every capability but a technician's own work, deleting the makerspace included", () => {
    for (const capability of Object.keys(CAPABILITIES) as Array<keyof typeof CAPABILITIES>) expect(can("BOOKINGS_MANAGER", capability)).toBe(capability !== "repairs.work");
  });

  it("follows the capability map", () => {
    expect(holders("makerspace.view")).toEqual(DESK);
    for (const capability of ["makerspace.settings", "makerspace.delete", "team.manage", "payments.settings", "spaces.manage", "bookings.approve", "bookings.override", "members.manage", "integrations.manage", "audit.view", "refunds.manage", "reports.finance", "payments.view", "repairs.manage", "repairs.pay", "finance.view", "finance.manage"] as const) {
      expect(holders(capability)).toEqual(["BOOKINGS_MANAGER"]);
    }
    expect(holders("bookings.manage")).toEqual(["BOOKINGS_MANAGER", "FRONT_DESK"]);
    expect(holders("bookings.contact")).toEqual(["BOOKINGS_MANAGER", "FRONT_DESK"]);
    expect(holders("payments.record")).toEqual(["BOOKINGS_MANAGER", "FRONT_DESK"]);
    expect(holders("reports.view")).toEqual(DESK);
    expect(holders("issues.report")).toEqual(ROLES);
    expect(holders("repairs.work")).toEqual(["TECHNICIAN"]);
    expect(can(null, "makerspace.view")).toBe(false);
  });

  it("ranks bookings manager over front desk over viewer", () => {
    expect(hasRoleAtLeast("BOOKINGS_MANAGER", "FRONT_DESK")).toBe(true);
    expect(hasRoleAtLeast("FRONT_DESK", "BOOKINGS_MANAGER")).toBe(false);
    expect(hasRoleAtLeast("FRONT_DESK", "VIEWER")).toBe(true);
    expect(hasRoleAtLeast("VIEWER", "FRONT_DESK")).toBe(false);
    expect(isMakerspaceAdmin("BOOKINGS_MANAGER")).toBe(true);
    expect(isMakerspaceAdmin("FRONT_DESK")).toBe(false);
  });

  it("lets bookings managers manage everyone, other bookings managers included, and no one else manage the team", () => {
    for (const role of ROLES) expect(canManageTeamMember("BOOKINGS_MANAGER", role)).toBe(true);
    for (const actor of ["FRONT_DESK", "VIEWER", "TECHNICIAN"] as const) for (const role of ROLES) expect(canManageTeamMember(actor, role)).toBe(false);
    expect(assignableRoles("BOOKINGS_MANAGER")).toEqual(ROLES);
    expect(assignableRoles("FRONT_DESK")).toEqual([]);
  });
});
