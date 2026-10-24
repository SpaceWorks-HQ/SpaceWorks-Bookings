import { describe, expect, it } from "vitest";
import {
  assignableTeamRoleSchema,
  createMakerspaceInviteSchema,
  makerspaceSlugSchema,
  updateMakerspaceSchema,
  updateTeamRoleSchema,
} from "@/lib/validators";

describe("makerspace web address", () => {
  it("accepts lowercase words joined by single hyphens", () => {
    expect(makerspaceSlugSchema.safeParse("kochi-runners").success).toBe(true);
    expect(makerspaceSlugSchema.parse("  rotary-club-2  ")).toBe("rotary-club-2");
  });

  it("rejects capitals, double or edge hyphens, and very short addresses", () => {
    for (const slug of ["Kochi", "kochi--runners", "-kochi", "kochi-", "k", "kochi runners", "kochi_runners"]) {
      expect(makerspaceSlugSchema.safeParse(slug).success, slug).toBe(false);
    }
  });

  it("refuses reserved addresses that would shadow app routes", () => {
    for (const slug of ["dashboard", "super-admin", "api", "verify", "start", "login"]) {
      expect(makerspaceSlugSchema.safeParse(slug).success, slug).toBe(false);
    }
  });
});

describe("team roles", () => {
  it("never hands out ownership through the role form", () => {
    expect(assignableTeamRoleSchema.safeParse("OWNER").success).toBe(false);
    expect(updateTeamRoleSchema.safeParse({ makerspaceSlug: "acme", targetUserId: "u", role: "OWNER" }).success).toBe(false);
    expect(updateTeamRoleSchema.safeParse({ makerspaceSlug: "acme", targetUserId: "u", role: "TREASURER" }).success).toBe(true);
  });

  it("defaults invites to the least-privileged role", () => {
    expect(createMakerspaceInviteSchema.parse({ makerspaceSlug: "acme" }).role).toBe("VIEWER");
    expect(createMakerspaceInviteSchema.safeParse({ makerspaceSlug: "acme", role: "OWNER" }).success).toBe(false);
  });
});

describe("makerspace settings", () => {
  const base = { makerspaceSlug: "demo", name: "Demo" };

  it("allows uploaded managed logos only", () => {
    expect(updateMakerspaceSchema.safeParse({ ...base, logoUrl: "/api/uploads/makerspaces/org_1/makerspace-logos/image.webp" }).success).toBe(true);
    expect(updateMakerspaceSchema.safeParse({ ...base, logoUrl: "" }).success).toBe(true);
    expect(updateMakerspaceSchema.safeParse({ ...base, logoUrl: "https://images.example.test/logo.png" }).success).toBe(false);
    expect(updateMakerspaceSchema.safeParse({ ...base, logoUrl: "data:text/html,unsafe" }).success).toBe(false);
  });

  it("requires a name", () => {
    expect(updateMakerspaceSchema.safeParse({ ...base, name: "   ", logoUrl: "" }).success).toBe(false);
  });
});
