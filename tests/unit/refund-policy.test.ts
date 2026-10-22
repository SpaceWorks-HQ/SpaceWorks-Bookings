import { describe, expect, it } from "vitest";
import { refundOffer, unusedShare } from "@/lib/payments/refundPolicy";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const base = { windowDays: 14, paidAt: day("2026-04-01"), refundableMinor: 120_000, membershipFeeMinor: 100_000, startsAt: day("2026-04-01"), endsAt: day("2027-04-01") };

describe("refund policy", () => {
  it("offers nothing under a no-refunds policy", () => {
    expect(refundOffer({ ...base, policy: "NONE", now: day("2026-04-02") })).toEqual({ eligible: false, reason: "no-refunds", deadline: null });
  });

  it("offers everything still refundable within the window, and nothing after it", () => {
    expect(refundOffer({ ...base, policy: "FULL", now: day("2026-04-10") })).toEqual({ eligible: true, amountMinor: 120_000, deadline: day("2026-04-15") });
    expect(refundOffer({ ...base, policy: "FULL", now: day("2026-04-16") })).toMatchObject({ eligible: false, reason: "window-closed" });
  });

  it("offers the unused share of the membership fee only, never the joining fee", () => {
    // 73 of 365 days used: 292/365 of ₹1,000 = ₹800.
    const offer = refundOffer({ ...base, policy: "PRO_RATA", windowDays: 90, now: day("2026-06-13") });
    expect(offer).toEqual({ eligible: true, amountMinor: 80_000, deadline: day("2026-06-30") });
  });

  it("offers the whole fee before the term starts and for lifetime memberships", () => {
    expect(unusedShare(day("2026-05-01"), day("2027-05-01"), day("2026-04-02"))).toBe(1);
    expect(refundOffer({ ...base, policy: "PRO_RATA", endsAt: null, now: day("2026-04-05") })).toMatchObject({ eligible: true, amountMinor: 100_000 });
  });

  it("never offers more than is left to refund, and says so when nothing is", () => {
    expect(refundOffer({ ...base, policy: "PRO_RATA", refundableMinor: 30_000, now: day("2026-04-02") })).toMatchObject({ eligible: true, amountMinor: 30_000 });
    expect(refundOffer({ ...base, policy: "FULL", refundableMinor: 0, now: day("2026-04-02") })).toMatchObject({ eligible: false, reason: "nothing-left" });
  });
});
