import type { RateKind, Space } from "@prisma/client";
import type { BookingRules } from "@/lib/bookingRules/schema";
import { resolveTaxSnapshot, type TaxSnapshot } from "@/lib/payments/tax";
import type { AddOnPricing, SpacePricing } from "@/lib/pricing/quote";
import type { PeakRuleInput } from "@/lib/pricing/peak";
import { compareDates, fromDbDate, localParts } from "@/lib/time/zoned";
import type { ObligationPolicy, RefundTierInput } from "./obligation";
import { invalidInput } from "./errors";
import type { Tx } from "./db";

/** Database inputs for pricing, member rates and the cancellation policy of a space. */

export function spacePricing(space: Space): SpacePricing {
  const { name, publicHourlyMinor, publicHalfDayMinor, publicDayMinor, memberHourlyMinor, memberHalfDayMinor, memberDayMinor, halfDayMinutes, dayMinutes, taxRateBps, sacCode } = space;
  return { name, publicHourlyMinor, publicHalfDayMinor, publicDayMinor, memberHourlyMinor, memberHalfDayMinor, memberDayMinor, halfDayMinutes, dayMinutes, taxRateBps, sacCode };
}

export async function loadTaxSnapshot(tx: Tx, makerspaceId: string, currency: string): Promise<TaxSnapshot> {
  return resolveTaxSnapshot(await tx.makerspaceTaxSettings.findUnique({ where: { makerspaceId } }), currency);
}

export async function loadPeakRules(tx: Tx, makerspaceId: string, spaceId: string): Promise<PeakRuleInput[]> {
  const rows = await tx.peakRule.findMany({ where: { makerspaceId, active: true, OR: [{ spaceId }, { spaceId: null }] }, orderBy: { id: "asc" } });
  return rows.map(({ id, name, weekdays, startMinute, endMinute, surchargeBps }) => ({ id, name, weekdays, startMinute, endMinute, surchargeBps }));
}

export type AddOnSelection = { addOnId: string; quantity: number };

/** The chosen add-ons, each active and offered on this space; anything else is refused. */
export async function loadAddOns(tx: Tx, makerspaceId: string, spaceId: string, selections: AddOnSelection[]): Promise<Array<{ addOn: AddOnPricing; quantity: number }>> {
  const wanted = selections.filter((selection) => selection.quantity > 0);
  if (wanted.length === 0) return [];
  if (wanted.some((selection) => !Number.isInteger(selection.quantity) || selection.quantity > 100)) throw invalidInput("Choose up to 100 of each extra.");
  const rows = await tx.addOn.findMany({ where: { makerspaceId, active: true, id: { in: wanted.map((selection) => selection.addOnId) }, OR: [{ spaceId }, { spaceId: null }] } });
  return wanted.map((selection) => {
    const row = rows.find((candidate) => candidate.id === selection.addOnId);
    if (!row) throw invalidInput("One of the extras is no longer offered.");
    return { addOn: { id: row.id, name: row.name, unit: row.unit, priceMinor: row.priceMinor, memberPriceMinor: row.memberPriceMinor, sacCode: row.sacCode }, quantity: selection.quantity };
  });
}

/** The space's own refund tiers if it has any, else the makerspace default. */
export async function loadRefundTiers(tx: Tx, makerspaceId: string, spaceId: string): Promise<RefundTierInput[]> {
  const rows = await tx.refundTier.findMany({ where: { makerspaceId, OR: [{ spaceId }, { spaceId: null }] } });
  const own = rows.filter((row) => row.spaceId === spaceId);
  return (own.length ? own : rows.filter((row) => row.spaceId === null)).map(({ minHoursBefore, refundBps }) => ({ minHoursBefore, refundBps })).sort((a, b) => b.minHoursBefore - a.minHoursBefore);
}

export type PolicySnapshot = ObligationPolicy & { refundTiers: RefundTierInput[] };

export async function loadPolicy(tx: Tx, makerspaceId: string, spaceId: string, rules: BookingRules): Promise<PolicySnapshot> {
  return {
    refundTiers: await loadRefundTiers(tx, makerspaceId, spaceId),
    depositRefundable: rules.depositRefundable,
    chargeLateCancelWhenUnpaid: rules.chargeLateCancelWhenUnpaid,
    noShowCharge: rules.noShowCharge,
  };
}

/** A booking's frozen policy (falls back to the defaults for a row written before it was frozen). */
export function readPolicy(value: unknown): PolicySnapshot {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<PolicySnapshot>;
  return {
    refundTiers: Array.isArray(raw.refundTiers) ? raw.refundTiers.filter((tier) => Number.isInteger(tier?.minHoursBefore) && Number.isInteger(tier?.refundBps)) : [],
    depositRefundable: raw.depositRefundable !== false,
    chargeLateCancelWhenUnpaid: raw.chargeLateCancelWhenUnpaid === true,
    noShowCharge: raw.noShowCharge === "NONE" ? "NONE" : "FULL",
  };
}

/**
 * Member rate per slot: the email must match an active member of the makerspace whose `validUntil` (a local date,
 * inclusive) is not before the slot's local date. Callers pass only a verified account email or, for staff
 * bookings, the email staff typed.
 */
export async function memberRateKinds(tx: Tx, makerspaceId: string, email: string | null, slots: Array<{ start: Date }>, timeZone: string): Promise<RateKind[]> {
  if (!email) return slots.map(() => "PUBLIC");
  const member = await tx.makerspaceMember.findUnique({ where: { makerspaceId_email: { makerspaceId, email: email.trim().toLowerCase() } } });
  if (!member || !member.active) return slots.map(() => "PUBLIC");
  return slots.map((slot) => {
    if (!member.validUntil) return "MEMBER";
    return compareDates(localParts(slot.start, timeZone).date, fromDbDate(member.validUntil)) <= 0 ? "MEMBER" : "PUBLIC";
  });
}
