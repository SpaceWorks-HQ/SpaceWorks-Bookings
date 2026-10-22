import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { buildMembershipExport, membershipExportCsv, type MembershipExportSource } from "@/lib/portal/dataExport";

const source = [{
  organisationId: "org_1", memberNumber: 7, name: "Shaan Shoukath", email: "shaan@example.test", phone: "+91 90000 00000", stateCode: "KL", gstin: null,
  isMinor: false, guardianName: null, guardianEmail: null, guardianPhone: null,
  fieldValues: { profession: "Systems Engineer", interview_score: "9/10" },
  createdAt: new Date("2026-04-02T06:00:00Z"),
  organisation: { name: "SpaceWorks", slug: "spaceworks" },
  unit: { name: "Kochi" },
  roles: [{ isPrimary: true, role: { name: "Systems Engineer" } }],
  terms: [{
    status: "ACTIVE", kind: "NEW", startsAt: new Date("2026-03-31T18:30:00Z"), endsAt: new Date("2027-03-31T18:30:00Z"), graceUntil: null,
    currency: "INR", priceMinor: 120_000, joiningFeeMinor: 50_000, createdAt: new Date("2026-04-02T06:00:00Z"),
    plan: { name: "Annual" },
    events: [{ from: null, to: "PENDING_APPROVAL", effectiveAt: new Date("2026-04-02T06:00:00Z"), cause: "applied" }],
  }],
  consents: [{ purpose: "membership", noticeVersion: "2026-10", grantedAt: new Date("2026-04-02T06:00:00Z"), withdrawnAt: null, byGuardian: false }],
  erasureRequests: [],
  refundRequests: [],
  payments: [],
  hiddenKeys: ["interview_score"],
}] as unknown as MembershipExportSource;

describe("membership data export", () => {
  it("includes the member's own records and leaves out managers' admin-only answers", () => {
    const [member] = buildMembershipExport(source);
    expect(member).toMatchObject({ organisation: "SpaceWorks", memberNumber: 7, email: "shaan@example.test", unit: "Kochi", roles: [{ name: "Systems Engineer", primary: true }] });
    expect(member.answers).toEqual({ profession: "Systems Engineer" });
    expect(member.terms[0]).toMatchObject({ plan: "Annual", status: "ACTIVE", priceMinor: 120_000, history: [{ to: "PENDING_APPROVAL", cause: "applied" }] });
    expect(JSON.stringify(member)).not.toContain("9/10");
  });

  it("writes one CSV row per term", () => {
    const csv = membershipExportCsv(buildMembershipExport(source));
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Member number");
    expect(lines[1]).toContain("SpaceWorks,7,Shaan Shoukath,shaan@example.test");
    expect(lines[1]).toContain("Annual,NEW,ACTIVE");
  });
});
