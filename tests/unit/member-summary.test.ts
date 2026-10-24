import { describe, expect, it } from "vitest";
import { filterTeam, firstName, roleBreakdown, roleDots, type TeamMemberRow } from "@/components/team/memberSummary";

const row = (overrides: Partial<TeamMemberRow>): TeamMemberRow => ({
  id: "m",
  userId: "u",
  name: "Someone",
  role: "VIEWER",
  joinedLabel: "Mar 2025",
  isYou: false,
  ...overrides,
});

const counts = (OWNER: number, SPACE_MANAGER: number, TREASURER: number, VIEWER: number, BOOKINGS_MANAGER = 0, FRONT_DESK = 0) => ({ OWNER, SPACE_MANAGER, BOOKINGS_MANAGER, FRONT_DESK, TREASURER, VIEWER });

describe("team summary helpers", () => {
  it("describes the role mix, skipping empty roles", () => {
    expect(roleBreakdown(counts(1, 2, 1, 3))).toBe("1 owner · 2 space managers · 1 treasurer · 3 viewers");
    expect(roleBreakdown(counts(1, 0, 0, 1))).toBe("1 owner · 1 viewer");
    expect(roleBreakdown(counts(0, 0, 0, 0))).toBe("No one yet");
    expect(roleBreakdown(counts(0, 0, 0, 0, 2, 1))).toBe("2 bookings managers · 1 front desk");
  });

  it("draws one dot per person up to the cap, ordered by role", () => {
    expect(roleDots(counts(1, 2, 1, 2))).toEqual(["OWNER", "SPACE_MANAGER", "SPACE_MANAGER", "TREASURER", "VIEWER", "VIEWER"]);
    const capped = roleDots(counts(1, 4, 1, 194), 24);
    expect(capped).toHaveLength(24);
    expect(capped[0]).toBe("OWNER");
    expect(capped.filter((r) => r === "TREASURER")).toHaveLength(1);
    expect(roleDots(counts(0, 0, 0, 0))).toEqual([]);
  });

  it("filters by tab and searches email only when it was sent", () => {
    const rows = [
      row({ id: "1", name: "Anand Nair", role: "OWNER", email: "anand@example.org" }),
      row({ id: "2", name: "Riya Kapoor", role: "SPACE_MANAGER", email: "riya@example.org" }),
      row({ id: "3", name: "Jo Thomas", role: "FRONT_DESK" }),
      row({ id: "4", name: "Sam Varghese", role: "VIEWER" }),
    ];
    expect(filterTeam(rows, "admins", "").map((r) => r.id)).toEqual(["1", "2"]);
    expect(filterTeam(rows, "others", "").map((r) => r.id)).toEqual(["3", "4"]);
    expect(filterTeam(rows, "everyone", "RIYA@").map((r) => r.id)).toEqual(["2"]);
    expect(filterTeam(rows, "everyone", "thomas").map((r) => r.id)).toEqual(["3"]);
    expect(filterTeam(rows.map((r) => ({ ...r, email: undefined })), "everyone", "example.org")).toEqual([]);
  });

  it("takes the first name for hints", () => {
    expect(firstName("  Priya L. ")).toBe("Priya");
    expect(firstName(null)).toBeNull();
  });
});
