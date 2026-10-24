import { describe, expect, it } from "vitest";
import type { TeamRole } from "@prisma/client";
import { assignableRoles, can, canManageTeamMember, CAPABILITIES, hasRoleAtLeast, isMakerspaceAdmin, ROLE_DESCRIPTIONS, ROLE_LABELS, roleWithArticle } from "@/lib/permissionRoles";

const ROLES: TeamRole[] = ["OWNER", "SPACE_MANAGER", "BOOKINGS_MANAGER", "FRONT_DESK", "TREASURER", "VIEWER"];
const holders = (capability: keyof typeof CAPABILITIES) => ROLES.filter((role) => can(role, capability));

describe("bookings roles", () => {
  it("labels and describes every role", () => {
    expect(ROLES.map((role) => ROLE_LABELS[role])).toEqual(["Owner", "Space manager", "Bookings manager", "Front desk", "Treasurer", "Viewer"]);
    for (const role of ROLES) expect(ROLE_DESCRIPTIONS[role].length).toBeGreaterThan(10);
    expect(roleWithArticle("OWNER")).toBe("an owner");
    expect(roleWithArticle("FRONT_DESK")).toBe("a front desk");
  });

  it("follows the capability map in the build plan", () => {
    expect(holders("makerspace.view")).toEqual(ROLES);
    expect(holders("makerspace.settings")).toEqual(["OWNER", "SPACE_MANAGER"]);
    expect(holders("makerspace.delete")).toEqual(["OWNER"]);
    expect(holders("team.manage")).toEqual(["OWNER", "SPACE_MANAGER"]);
    expect(holders("payments.settings")).toEqual(["OWNER", "SPACE_MANAGER"]);
    expect(holders("spaces.manage")).toEqual(["OWNER", "SPACE_MANAGER", "BOOKINGS_MANAGER"]);
    expect(holders("bookings.manage")).toEqual(["OWNER", "SPACE_MANAGER", "BOOKINGS_MANAGER", "FRONT_DESK"]);
    expect(holders("bookings.approve")).toEqual(["OWNER", "SPACE_MANAGER", "BOOKINGS_MANAGER"]);
    expect(holders("bookings.override")).toEqual(["OWNER", "SPACE_MANAGER", "BOOKINGS_MANAGER"]);
    expect(holders("bookings.contact")).toEqual(ROLES.filter((role) => role !== "VIEWER"));
    expect(holders("payments.view")).toEqual(["OWNER", "SPACE_MANAGER", "BOOKINGS_MANAGER", "FRONT_DESK", "TREASURER"]);
    expect(holders("payments.record")).toEqual(["OWNER", "SPACE_MANAGER", "FRONT_DESK", "TREASURER"]);
    expect(holders("refunds.manage")).toEqual(["OWNER", "SPACE_MANAGER", "TREASURER"]);
    expect(holders("members.manage")).toEqual(["OWNER", "SPACE_MANAGER", "BOOKINGS_MANAGER"]);
    expect(holders("reports.view")).toEqual(ROLES);
    expect(holders("reports.finance")).toEqual(["OWNER", "SPACE_MANAGER", "TREASURER"]);
    expect(holders("integrations.manage")).toEqual(["OWNER", "SPACE_MANAGER"]);
    expect(holders("audit.view")).toEqual(["OWNER", "SPACE_MANAGER"]);
    expect(can(null, "makerspace.view")).toBe(false);
  });

  it("ranks owner over space manager over bookings manager over front desk and treasurer over viewer", () => {
    expect(hasRoleAtLeast("SPACE_MANAGER", "BOOKINGS_MANAGER")).toBe(true);
    expect(hasRoleAtLeast("FRONT_DESK", "TREASURER")).toBe(true);
    expect(hasRoleAtLeast("TREASURER", "FRONT_DESK")).toBe(true);
    expect(hasRoleAtLeast("VIEWER", "FRONT_DESK")).toBe(false);
    expect(isMakerspaceAdmin("SPACE_MANAGER")).toBe(true);
    expect(isMakerspaceAdmin("BOOKINGS_MANAGER")).toBe(false);
  });

  it("lets owners manage everyone and space managers only less senior roles", () => {
    for (const role of ROLES) expect(canManageTeamMember("OWNER", role)).toBe(true);
    expect(canManageTeamMember("SPACE_MANAGER", "SPACE_MANAGER")).toBe(false);
    expect(canManageTeamMember("SPACE_MANAGER", "OWNER")).toBe(false);
    expect(canManageTeamMember("SPACE_MANAGER", "BOOKINGS_MANAGER")).toBe(true);
    expect(canManageTeamMember("BOOKINGS_MANAGER", "VIEWER")).toBe(false);
    expect(assignableRoles("OWNER")).toEqual(["SPACE_MANAGER", "BOOKINGS_MANAGER", "FRONT_DESK", "TREASURER", "VIEWER"]);
    expect(assignableRoles("SPACE_MANAGER")).toEqual(["BOOKINGS_MANAGER", "FRONT_DESK", "TREASURER", "VIEWER"]);
    expect(assignableRoles("TREASURER")).toEqual([]);
  });
});
