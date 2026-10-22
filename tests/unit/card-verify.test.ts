import { describe, expect, it } from "vitest";
import { verificationView, type VerifyRecord } from "@/lib/cards/verify";
import type { TermLike } from "@/lib/membership/lifecycle";

const now = new Date("2026-10-20T06:00:00Z");
const term = (patch: Partial<TermLike> = {}): TermLike => ({
  id: "t1",
  status: "ACTIVE",
  startsAt: new Date("2026-04-01T00:00:00Z"),
  endsAt: new Date("2027-03-31T18:30:00Z"),
  graceUntil: new Date("2027-04-15T18:30:00Z"),
  createdAt: new Date("2026-04-01T00:00:00Z"),
  ...patch,
});

function record(patch: Partial<VerifyRecord> = {}): VerifyRecord {
  return {
    card: { cardNumber: "SWO-0042", revokedAt: null, revokedReason: null },
    member: { name: "Shaan Shoukath", anonymisedAt: null, photoUrl: "/api/uploads/x" },
    plan: { name: "Annual member" },
    organisation: { name: "SpaceWorks", slug: "spaceworks", status: "ACTIVE", timezone: "Asia/Kolkata", logoUrl: null },
    terms: [term()],
    ...patch,
  };
}

describe("verify view", () => {
  it("shows a current member with name, organisation, plan and valid-until, and nothing else", () => {
    const view = verificationView(record(), now);
    expect(view).toEqual({
      state: "member",
      verdict: "valid",
      name: "Shaan Shoukath",
      organisationName: "SpaceWorks",
      organisationSlug: "spaceworks",
      organisationLogoUrl: null,
      timeZone: "Asia/Kolkata",
      planName: "Annual member",
      cardNumber: "SWO-0042",
      validUntil: "31 Mar 2027",
      photoUrl: "/api/uploads/x",
    });
    expect(JSON.stringify(view)).not.toMatch(/@|phone|email/i);
  });

  it("reads the status live from the dates, not the stored status", () => {
    expect(verificationView(record(), new Date("2027-04-05T00:00:00Z"))).toMatchObject({ verdict: "grace" });
    expect(verificationView(record(), new Date("2027-05-01T00:00:00Z"))).toMatchObject({ verdict: "expired", photoUrl: null });
  });

  it("follows a renewal: the card keeps verifying on the new term", () => {
    const renewal = term({ id: "t2", renewedFromId: "t1", startsAt: new Date("2027-03-31T18:30:00Z"), endsAt: new Date("2028-03-31T18:30:00Z"), graceUntil: null, createdAt: new Date("2027-03-01T00:00:00Z") });
    expect(verificationView(record({ terms: [term({ status: "ENDED" }), renewal] }), new Date("2027-06-01T00:00:00Z"))).toMatchObject({ verdict: "valid", validUntil: "31 Mar 2028" });
  });

  it("shows a revoked membership without a valid-until date", () => {
    expect(verificationView(record({ terms: [term({ status: "REVOKED" })] }), now)).toMatchObject({ verdict: "revoked", validUntil: null, photoUrl: null });
  });

  it("shows revoked and replaced cards by state alone", () => {
    expect(verificationView(record({ card: { cardNumber: "SWO-0042", revokedAt: now, revokedReason: "REVOKED" } }), now)).toEqual({ state: "card-revoked", organisationName: "SpaceWorks" });
    expect(verificationView(record({ card: { cardNumber: "SWO-0042", revokedAt: now, revokedReason: "REISSUED" } }), now)).toEqual({ state: "card-replaced", organisationName: "SpaceWorks" });
  });

  it("says when the organisation is suspended, and hides erased members and closed organisations", () => {
    expect(verificationView(record({ organisation: { ...record().organisation, status: "SUSPENDED" } }), now)).toEqual({ state: "suspended", organisationName: "SpaceWorks" });
    expect(verificationView(record({ organisation: { ...record().organisation, status: "REJECTED" } }), now)).toEqual({ state: "not-found" });
    expect(verificationView(record({ member: { name: "x", anonymisedAt: now, photoUrl: null } }), now)).toEqual({ state: "not-found" });
    expect(verificationView(null, now)).toEqual({ state: "not-found" });
  });
});
