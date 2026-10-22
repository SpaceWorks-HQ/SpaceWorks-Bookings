import "server-only";

import { randomBytes } from "node:crypto";
import type { MemberCard, Prisma } from "@prisma/client";
import { recordAuditEvent } from "@/lib/audit";
import { deriveCardPrefix, formatCardNumber } from "./core";

/*
 * Issuing, reissuing and revoking member cards. Every change locks the member row first, so two
 * activations (or a manager and an activation) cannot both issue; the partial unique index on live
 * cards is the final guard. The card number is stable (prefix + member number); a reissue keeps it
 * and changes only the verify token, so the old QR stops verifying.
 */

type Tx = Prisma.TransactionClient;
type CardRef = { organisationId: string; memberId: string; planId: string };

export class CardError extends Error {
  override name = "CardError";
}

/** 32 random bytes as base64url: 43 characters. */
export function newVerifyToken() {
  return randomBytes(32).toString("base64url");
}

async function lockMember(tx: Tx, organisationId: string, memberId: string) {
  const rows = await tx.$queryRaw<Array<{ memberNumber: number; anonymisedAt: Date | null }>>`
    SELECT "memberNumber", "anonymisedAt" FROM "Member" WHERE "id" = ${memberId} AND "organisationId" = ${organisationId} FOR UPDATE`;
  const member = rows[0];
  if (!member || member.anonymisedAt) throw new CardError("Member not found.");
  return member;
}

/** The organisation's card number prefix: from its default design, else derived from its name. */
async function numberPrefix(tx: Tx, organisationId: string) {
  const design = await tx.cardDesign.findFirst({ where: { organisationId, planId: null }, select: { numberPrefix: true } });
  if (design) return design.numberPrefix;
  const org = await tx.organisation.findUniqueOrThrow({ where: { id: organisationId }, select: { name: true } });
  return deriveCardPrefix(org.name);
}

async function createCard(tx: Tx, ref: CardRef, memberNumber: number, actorUserId: string | null, cardNumber?: string) {
  const card = await tx.memberCard.create({
    data: { ...ref, cardNumber: cardNumber ?? formatCardNumber(await numberPrefix(tx, ref.organisationId), memberNumber), verifyToken: newVerifyToken(), issuedById: actorUserId },
  });
  return card;
}

function liveCard(tx: Tx, ref: CardRef) {
  return tx.memberCard.findFirst({ where: { ...ref, revokedAt: null } });
}

/** Issue a card for (member, plan) unless a live one exists. Returns the live card and whether it is new. */
export async function issueCard(tx: Tx, ref: CardRef, actorUserId: string | null): Promise<{ card: MemberCard; created: boolean }> {
  const member = await lockMember(tx, ref.organisationId, ref.memberId);
  const existing = await liveCard(tx, ref);
  if (existing) return { card: existing, created: false };
  const card = await createCard(tx, ref, member.memberNumber, actorUserId);
  await recordAuditEvent({ action: "CARD_ISSUED", actorUserId, organisationId: ref.organisationId, targetType: "MemberCard", targetId: card.id, client: tx });
  return { card, created: true };
}

/**
 * Called when a term starts (lib/membership/service.ts activateTerm). A first activation issues the
 * card; renewals keep the card they have. A renewal for someone who never had a card on this plan
 * (members from before cards existed) also gets one, but a card a manager revoked is never brought
 * back by a renewal: that takes a manager's reissue.
 */
export async function issueCardOnActivation(tx: Tx, term: { organisationId: string; memberId: string; planId: string; kind: string }, actorUserId: string | null) {
  const ref = { organisationId: term.organisationId, memberId: term.memberId, planId: term.planId };
  if (term.kind === "RENEWAL" && (await tx.memberCard.count({ where: ref })) > 0) return null;
  try {
    return await issueCard(tx, ref, actorUserId);
  } catch (error) {
    // An erased member gets no card, but their membership change still goes through.
    if (error instanceof CardError) return null;
    throw error;
  }
}

/** Replace the live card (lost card, changed details): the old one shows as replaced, the new one gets a new QR. */
export async function reissueCard(tx: Tx, ref: CardRef, actorUserId: string) {
  const member = await lockMember(tx, ref.organisationId, ref.memberId);
  const old = await liveCard(tx, ref);
  if (old) await tx.memberCard.update({ where: { id: old.id }, data: { revokedAt: new Date(), revokedById: actorUserId, revokedReason: "REISSUED" } });
  // The replacement keeps the printed number, even if the prefix has changed since.
  const card = await createCard(tx, ref, member.memberNumber, actorUserId, old?.cardNumber);
  await recordAuditEvent({ action: old ? "CARD_REISSUED" : "CARD_ISSUED", actorUserId, organisationId: ref.organisationId, targetType: "MemberCard", targetId: card.id, metadata: old ? { replaces: old.id } : undefined, client: tx });
  return card;
}

/** Revoke a live card. The membership itself is untouched; /verify shows the card as revoked. */
export async function revokeCard(tx: Tx, args: { organisationId: string; cardId: string; actorUserId: string }) {
  const card = await tx.memberCard.findFirst({ where: { id: args.cardId, organisationId: args.organisationId } });
  if (!card) throw new CardError("Card not found.");
  await lockMember(tx, args.organisationId, card.memberId);
  const { count } = await tx.memberCard.updateMany({ where: { id: card.id, revokedAt: null }, data: { revokedAt: new Date(), revokedById: args.actorUserId, revokedReason: "REVOKED" } });
  if (count === 0) throw new CardError("This card was already revoked.");
  await recordAuditEvent({ action: "CARD_REVOKED", actorUserId: args.actorUserId, organisationId: args.organisationId, targetType: "MemberCard", targetId: card.id, client: tx });
  return card;
}
