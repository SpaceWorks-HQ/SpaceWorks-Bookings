import { describe, expect, it } from "vitest";
import { membershipSummary, periodSets, renewalOutcomes } from "@/lib/reports/metrics/flows";
import { countStanding, standingAt } from "@/lib/reports/metrics/standing";
import { build, event, ist, member, term } from "../helpers/reportFixtures";

const FY = { from: ist("2026-04-01"), to: ist("2027-04-01") };
const NOW = ist("2026-10-20", "12:00");

describe("Active(t) and Grace(t)", () => {
  const data = build(
    [member("m1"), member("m2"), member("m3")],
    [
      term({ id: "a", member: "m1", status: "ACTIVE", starts: "2026-04-01", ends: "2027-04-01", grace: "2027-04-16" }),
      // Ended 1 Oct with grace to 16 Oct: lapsed by the 20th, in grace on the 10th.
      term({ id: "g", member: "m2", status: "LAPSED", starts: "2025-10-01", ends: "2026-10-01", grace: "2026-10-16" }),
      term({ id: "p", member: "m3", status: "PENDING_PAYMENT", created: "2026-10-01" }),
    ],
  );

  it("counts GRACE separately and never as active", () => {
    expect(countStanding(data, ist("2026-10-10"))).toEqual({ active: 1, grace: 1 });
    expect(standingAt(data.termsByMember.get("m2"), ist("2026-10-10"))).toBe("GRACE");
  });

  it("treats the end date as exclusive and ignores unpaid terms", () => {
    expect(standingAt(data.termsByMember.get("m2"), new Date(ist("2026-10-01").getTime() - 1))).toBe("ACTIVE");
    expect(standingAt(data.termsByMember.get("m2"), ist("2026-10-01"))).toBe("GRACE");
    expect(standingAt(data.termsByMember.get("m2"), ist("2026-10-16"))).toBeNull();
    expect(standingAt(data.termsByMember.get("m3"), NOW)).toBeNull();
  });

  it("stops counting a revoked term from its revocation", () => {
    const revoked = build([member("m1")], [term({ id: "r", member: "m1", status: "REVOKED", starts: "2026-04-01", ends: "2027-04-01" })], [event("r", "ACTIVE", "REVOKED", ist("2026-06-01"))]);
    expect(standingAt(revoked.termsByMember.get("m1"), ist("2026-05-31"))).toBe("ACTIVE");
    expect(standingAt(revoked.termsByMember.get("m1"), ist("2026-06-01"))).toBeNull();
    expect(periodSets(revoked, FY, NOW).revoked.has("m1")).toBe(true);
  });
});

describe("renewal rate", () => {
  it("is null when nothing came up for renewal", () => {
    const data = build([member("m1")], [term({ id: "a", member: "m1", status: "ACTIVE", starts: "2026-04-01", ends: "2027-04-01" })]);
    expect(membershipSummary(data, FY, NOW).renewalRate).toBeNull();
  });

  it("waits for open terms: a term still in grace is neither renewed nor lapsed", () => {
    const data = build([member("m1")], [term({ id: "a", member: "m1", status: "GRACE", starts: "2025-10-15", ends: "2026-10-15", grace: "2026-10-30" })]);
    const outcome = renewalOutcomes(data, FY, NOW);
    expect([outcome.due.length, outcome.renewed.length, outcome.lapsed.length, outcome.open.length]).toEqual([1, 0, 0, 1]);
    expect(membershipSummary(data, FY, NOW).renewalRate).toBeNull();
  });

  it("counts early, on-time and grace renewals as renewed, and divides by decided terms only", () => {
    const data = build(
      [member("m1"), member("m2"), member("m3"), member("m4")],
      [
        term({ id: "e1", member: "m1", status: "ENDED", starts: "2025-07-01", ends: "2026-07-01", grace: "2026-07-16" }),
        term({ id: "e2", member: "m1", status: "ACTIVE", starts: "2026-07-01", ends: "2027-07-01", renewedFrom: "e1", created: "2026-06-10" }),
        term({ id: "l1", member: "m2", status: "LAPSED", starts: "2025-08-01", ends: "2026-08-01", grace: "2026-08-16" }),
        term({ id: "u1", member: "m3", status: "ACTIVE", starts: "2025-10-25", ends: "2026-10-25", grace: "2026-11-09" }),
        term({ id: "u2", member: "m3", status: "UPCOMING", starts: "2026-10-25", ends: "2027-10-25", renewedFrom: "u1", created: "2026-10-01" }),
        // Revoked terms are never "due": revocations are counted on their own.
        term({ id: "r1", member: "m4", status: "REVOKED", starts: "2025-09-01", ends: "2026-09-01" }),
      ],
      [event("r1", "ACTIVE", "REVOKED", ist("2026-05-01"))],
    );
    const s = membershipSummary(data, FY, NOW);
    expect(s.due).toBe(2);
    expect(s.renewed).toBe(1);
    expect(s.dueLapsed).toBe(1);
    expect(s.renewalRate).toBe(0.5);
    // The early renewal (u1 → u2) is not due until its end date arrives; then it counts as renewed.
    expect(renewalOutcomes(data, { from: ist("2026-10-01"), to: ist("2026-11-30") }, NOW).due).toEqual([]);
    expect(renewalOutcomes(data, { from: ist("2026-10-01"), to: ist("2026-11-30") }, ist("2026-10-26")).renewed.map((t) => t.id)).toEqual(["u1"]);
  });
});

describe("joined, came back, lapsed and churn", () => {
  const data = build(
    [member("m1"), member("m2"), member("m3"), member("m4")],
    [
      term({ id: "old", member: "m1", status: "ACTIVE", starts: "2025-04-01", ends: "2027-04-01" }),
      term({ id: "n", member: "m2", status: "ACTIVE", starts: "2026-06-01", ends: "2027-04-01" }),
      // m3 lapsed in 2025 and came back in 2026: a reactivation, not a new member.
      term({ id: "x1", member: "m3", status: "LAPSED", starts: "2024-04-01", ends: "2025-04-01", grace: "2025-04-16" }),
      term({ id: "x2", member: "m3", status: "ACTIVE", kind: "NEW", starts: "2026-07-01", ends: "2027-04-01" }),
      // m4 lapses inside the year and does not come back: churned.
      term({ id: "y", member: "m4", status: "LAPSED", starts: "2025-09-01", ends: "2026-09-01", grace: "2026-09-16" }),
    ],
  );
  const s = membershipSummary(data, FY, NOW);

  it("separates new members from members who came back", () => {
    expect(s.joined).toBe(1);
    expect(s.reactivated).toBe(1);
    expect(periodSets(data, FY, NOW).joined.has("m2")).toBe(true);
    expect(periodSets(data, FY, NOW).reactivated.has("m3")).toBe(true);
  });

  it("counts churn as lapsed and not back, over active at the start", () => {
    expect(s.activeStart).toBe(2);
    expect(s.lapsed).toBe(1);
    expect(s.churned).toBe(1);
    expect(s.churnRate).toBe(0.5);
    expect(s.activeEnd).toBe(3);
    expect(s.netChange).toBe(1);
    expect(s.activeStart + s.joined + s.reactivated - s.churned - s.revoked + s.otherChange).toBe(s.activeEnd);
  });

  it("has no churn rate without members at the start", () => {
    const empty = build([member("m1")], [term({ id: "a", member: "m1", status: "ACTIVE", starts: "2026-05-01", ends: "2027-04-01" })]);
    expect(membershipSummary(empty, FY, NOW).churnRate).toBeNull();
    expect(membershipSummary(empty, FY, NOW).retentionRate).toBeNull();
  });

  it("uses the effective time of events, not when they were recorded", () => {
    // A lapse the sweep recorded late still lapses on its grace end.
    expect(periodSets(data, { from: ist("2026-09-16"), to: ist("2026-09-17") }, NOW).lapsed.has("m4")).toBe(true);
    expect(periodSets(data, { from: ist("2026-09-17"), to: ist("2026-10-01") }, NOW).lapsed.has("m4")).toBe(false);
  });
});
