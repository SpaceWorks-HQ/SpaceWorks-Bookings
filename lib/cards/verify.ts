import { deriveStatus, type TermLike } from "@/lib/membership/lifecycle";
import { cardState, formatValidUntil } from "./core";

/*
 * What the public verify page may show. Only a live card in an active (or suspended) organisation
 * shows who it belongs to: name, organisation, plan, the membership's status right now (from
 * deriveStatus, so renewals and lapses show without reissuing) and valid-until. Never contact
 * details. A revoked or replaced card shows its state and organisation only; unknown tokens,
 * erased members and organisations that are not running are all the same "not found", so the page
 * never confirms that a token or a person exists.
 */

export type VerifyVerdict = "valid" | "grace" | "not-yet" | "expired" | "revoked";

export type VerifyView =
  | { state: "not-found" }
  | { state: "card-revoked" | "card-replaced" | "suspended"; organisationName: string }
  | {
      state: "member";
      verdict: VerifyVerdict;
      name: string;
      organisationName: string;
      organisationSlug: string;
      organisationLogoUrl: string | null;
      timeZone: string;
      planName: string;
      cardNumber: string;
      validUntil: string | null;
      photoUrl: string | null;
    };

export type VerifyRecord = {
  card: { cardNumber: string; revokedAt: Date | null; revokedReason: string | null };
  member: { name: string; anonymisedAt: Date | null; photoUrl: string | null };
  plan: { name: string };
  organisation: { name: string; slug: string; status: string; timezone: string; logoUrl: string | null };
  terms: TermLike[];
};

export const VERDICT_LABELS: Record<VerifyVerdict, string> = {
  valid: "Current member",
  grace: "Renewal due",
  "not-yet": "Not started yet",
  expired: "Not a current member",
  revoked: "Membership revoked",
};

export function verificationView(record: VerifyRecord | null, now = new Date()): VerifyView {
  if (!record || record.member.anonymisedAt) return { state: "not-found" };
  const { organisation } = record;
  if (organisation.status === "SUSPENDED" || organisation.status === "ARCHIVED") return { state: "suspended", organisationName: organisation.name };
  if (organisation.status !== "ACTIVE") return { state: "not-found" };
  const card = cardState(record.card);
  if (card !== "live") return { state: card === "replaced" ? "card-replaced" : "card-revoked", organisationName: organisation.name };

  const standing = deriveStatus(record.terms, now);
  const verdict: VerifyVerdict = standing.status === "ACTIVE"
    ? "valid"
    : standing.status === "GRACE"
      ? "grace"
      : standing.status === "UPCOMING"
        ? "not-yet"
        : standing.status === "REVOKED"
          ? "revoked"
          : "expired";
  const current = standing.current;
  return {
    state: "member",
    verdict,
    name: record.member.name,
    organisationName: organisation.name,
    organisationSlug: organisation.slug,
    organisationLogoUrl: organisation.logoUrl,
    timeZone: organisation.timezone,
    planName: record.plan.name,
    cardNumber: record.card.cardNumber,
    validUntil: current?.startsAt && verdict !== "revoked" ? formatValidUntil(current.endsAt, organisation.timezone) : null,
    photoUrl: verdict === "valid" || verdict === "grace" ? record.member.photoUrl : null,
  };
}
