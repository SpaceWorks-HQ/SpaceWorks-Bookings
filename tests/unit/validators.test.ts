import { describe, expect, it } from "vitest";
import {
  assignableTeamRoleSchema,
  createOrgInviteSchema,
  organisationSlugSchema,
  updateOrganisationSchema,
  updateTeamRoleSchema,
} from "@/lib/validators";

describe("organisation web address", () => {
  it("accepts lowercase words joined by single hyphens", () => {
    expect(organisationSlugSchema.safeParse("kochi-runners").success).toBe(true);
    expect(organisationSlugSchema.parse("  rotary-club-2  ")).toBe("rotary-club-2");
  });

  it("rejects capitals, double or edge hyphens, and very short addresses", () => {
    for (const slug of ["Kochi", "kochi--runners", "-kochi", "kochi-", "k", "kochi runners", "kochi_runners"]) {
      expect(organisationSlugSchema.safeParse(slug).success, slug).toBe(false);
    }
  });

  it("refuses reserved addresses that would shadow app routes", () => {
    for (const slug of ["dashboard", "super-admin", "api", "verify", "start", "login"]) {
      expect(organisationSlugSchema.safeParse(slug).success, slug).toBe(false);
    }
  });
});

describe("team roles", () => {
  it("never hands out ownership through the role form", () => {
    expect(assignableTeamRoleSchema.safeParse("OWNER").success).toBe(false);
    expect(updateTeamRoleSchema.safeParse({ organisationSlug: "acme", targetUserId: "u", role: "OWNER" }).success).toBe(false);
    expect(updateTeamRoleSchema.safeParse({ organisationSlug: "acme", targetUserId: "u", role: "TREASURER" }).success).toBe(true);
  });

  it("defaults invites to the least-privileged role", () => {
    expect(createOrgInviteSchema.parse({ organisationSlug: "acme" }).role).toBe("VIEWER");
    expect(createOrgInviteSchema.safeParse({ organisationSlug: "acme", role: "OWNER" }).success).toBe(false);
  });
});

describe("organisation settings", () => {
  const base = { organisationSlug: "demo", name: "Demo" };

  it("allows uploaded managed logos only", () => {
    expect(updateOrganisationSchema.safeParse({ ...base, logoUrl: "/api/uploads/organisations/org_1/organisation-logos/image.webp" }).success).toBe(true);
    expect(updateOrganisationSchema.safeParse({ ...base, logoUrl: "" }).success).toBe(true);
    expect(updateOrganisationSchema.safeParse({ ...base, logoUrl: "https://images.example.test/logo.png" }).success).toBe(false);
    expect(updateOrganisationSchema.safeParse({ ...base, logoUrl: "data:text/html,unsafe" }).success).toBe(false);
  });

  it("requires a name", () => {
    expect(updateOrganisationSchema.safeParse({ ...base, name: "   ", logoUrl: "" }).success).toBe(false);
  });
});
