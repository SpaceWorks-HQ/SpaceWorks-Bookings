import type { AddOnUnit, PaymentLineKind, RateKind } from "@prisma/client";
import { formatDate, formatTime } from "@/lib/format/datetime";
import { apportion, splitTax, type TaxSnapshot, type TaxSplit } from "@/lib/payments/tax";
import { cheapestBlocks, describePlan, divRoundHalfUp, hasAnyRate, ratesFor, type SpaceRates } from "./blocks";
import { peakMinutes, peakSurcharge, type PeakRuleInput } from "./peak";

/**
 * Price a booking: one SPACE line per slot (cheapest blocks × quantity), PEAK lines, ADD_ON lines, each taxed on its
 * own (lib/payments/tax.ts) at the space's rate. Renting space is supplied where the property is, so the place of
 * supply is the makerspace's own state (docs/GST.md). The total is then shared across occurrence rows by largest
 * remainder, so the rows add up to it exactly. Pure; the result is frozen onto the booking as `priceSnapshot`.
 */

export const QUOTE_VERSION = 1;

export type SpacePricing = SpaceRates & { name: string; taxRateBps: number | null; sacCode: string | null };
export type AddOnPricing = { id: string; name: string; unit: AddOnUnit; priceMinor: number; memberPriceMinor: number | null; sacCode: string | null };
export type SlotInput = { start: Date; end: Date; rateKind: RateKind };
export type QuoteInput = {
  currency: string;
  timeZone: string;
  space: SpacePricing;
  stepMinutes: number;
  slots: SlotInput[];
  quantity: number;
  attendees: number;
  addOns: Array<{ addOn: AddOnPricing; quantity: number }>;
  peakRules: PeakRuleInput[];
  /** The makerspace snapshot (resolveTaxSnapshot); the space's overrides are applied here. */
  tax: TaxSnapshot;
};

export type PriceLine = TaxSplit & {
  kind: "SPACE" | "PEAK" | "ADD_ON";
  paymentKind: PaymentLineKind;
  description: string;
  detail: string;
  /** The slot the line belongs to; null for once-per-booking add-ons. */
  slotIndex: number | null;
  refId: string | null;
  /** The price before tax treatment (the total when inclusive, the taxable value when exclusive). */
  listedMinor: number;
  sac: string | null;
};

export type Quote = {
  version: number;
  currency: string;
  quantity: number;
  attendees: number;
  rateKinds: RateKind[];
  addOns: Array<{ id: string; quantity: number }>;
  lines: PriceLine[];
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  /** Per slot: its lines' amounts (tax included). */
  slotTotals: number[];
  /** Per occurrence row, slot-major (slot 0 unit 0, slot 0 unit 1, …); sums to totalMinor. */
  occurrencePrices: number[];
  tax: TaxSnapshot;
};

export class PricingError extends Error {
  override name = "PricingError";
  constructor(readonly code: "NO_RATE", message: string) {
    super(message);
  }
}

/** The makerspace's tax snapshot with a space's rate and SAC overrides. */
export function spaceTaxSnapshot(base: TaxSnapshot, space: Pick<SpacePricing, "taxRateBps" | "sacCode">): TaxSnapshot {
  const taxable = base.mode === "SIMPLE" || (base.mode === "GST" && base.documentKind === "TAX_INVOICE" && !base.zeroRatedExport);
  return {
    ...base,
    rateBps: taxable && space.taxRateBps != null ? space.taxRateBps : base.rateBps,
    sac: base.sac && space.sacCode ? space.sacCode : base.sac,
  };
}

function addOnPrice(addOn: AddOnPricing, kind: RateKind) {
  if (kind !== "MEMBER" || addOn.memberPriceMinor == null) return addOn.priceMinor;
  return Math.min(addOn.memberPriceMinor, addOn.priceMinor);
}

function slotLabel(input: QuoteInput, slot: SlotInput) {
  return `${formatDate(slot.start, input.timeZone)}, ${formatTime(slot.start, input.timeZone)} to ${formatTime(slot.end, input.timeZone)}`;
}

function rawLines(input: QuoteInput) {
  const lines: Array<Omit<PriceLine, keyof TaxSplit | "sac"> & { addOnSac?: string | null }> = [];
  const bookingKind: RateKind = input.slots.length > 0 && input.slots.every((slot) => slot.rateKind === "MEMBER") ? "MEMBER" : "PUBLIC";
  input.slots.forEach((slot, slotIndex) => {
    const minutes = Math.round((slot.end.getTime() - slot.start.getTime()) / 60_000);
    const rates = ratesFor(input.space, slot.rateKind);
    const plan = hasAnyRate(rates) ? cheapestBlocks(minutes, rates, input.stepMinutes) : null;
    if (!plan) throw new PricingError("NO_RATE", `${input.space.name} has no price for ${minutes} minutes.`);
    const label = slotLabel(input, slot);
    const units = input.quantity > 1 ? ` × ${input.quantity}` : "";
    lines.push({ kind: "SPACE", paymentKind: "BOOKING", description: `${input.space.name}, ${label}`, detail: `${describePlan(plan)}${units}${slot.rateKind === "MEMBER" ? ", member rate" : ""}`, slotIndex, refId: null, listedMinor: plan.amountMinor * input.quantity });
    for (const rule of input.peakRules) {
      const peak = peakMinutes(slot.start, slot.end, rule, input.timeZone);
      const surcharge = peakSurcharge(rates, peak, rule.surchargeBps);
      if (!surcharge) continue;
      lines.push({ kind: "PEAK", paymentKind: "BOOKING", description: `${rule.name}, ${label}`, detail: `${peak} min at +${rule.surchargeBps / 100}%${units}`, slotIndex, refId: rule.id, listedMinor: surcharge * input.quantity });
    }
    for (const { addOn, quantity } of input.addOns) {
      if (addOn.unit === "PER_BOOKING" || quantity <= 0) continue;
      const price = addOnPrice(addOn, slot.rateKind);
      const listedMinor = addOn.unit === "PER_HOUR" ? divRoundHalfUp(BigInt(price) * BigInt(minutes) * BigInt(quantity), 60) : price * Math.max(0, input.attendees) * quantity;
      const detail = addOn.unit === "PER_HOUR" ? `${quantity} × ${minutes} min` : `${quantity} × ${input.attendees} ${input.attendees === 1 ? "person" : "people"}`;
      lines.push({ kind: "ADD_ON", paymentKind: "ADD_ON", description: `${addOn.name}, ${label}`, detail, slotIndex, refId: addOn.id, listedMinor, addOnSac: addOn.sacCode });
    }
  });
  for (const { addOn, quantity } of input.addOns) {
    if (addOn.unit !== "PER_BOOKING" || quantity <= 0) continue;
    lines.push({ kind: "ADD_ON", paymentKind: "ADD_ON", description: addOn.name, detail: `${quantity} per booking`, slotIndex: null, refId: addOn.id, listedMinor: addOnPrice(addOn, bookingKind) * quantity, addOnSac: addOn.sacCode });
  }
  return lines;
}

export function priceBooking(input: QuoteInput): Quote {
  const tax = spaceTaxSnapshot(input.tax, input.space);
  // Space rental: the place of supply is the property, in the makerspace's state (intra-state GST).
  const pos = tax.supplierState;
  const lines: PriceLine[] = rawLines(input).map(({ addOnSac, ...line }) => ({ ...line, ...splitTax(line.listedMinor, tax, pos), sac: tax.sac ? (addOnSac ?? tax.sac) : null }));
  const slotTotals = input.slots.map((_, index) => lines.filter((line) => line.slotIndex === index).reduce((sum, line) => sum + line.amountMinor, 0));
  const totalMinor = lines.reduce((sum, line) => sum + line.amountMinor, 0);
  const subtotalMinor = lines.reduce((sum, line) => sum + line.taxableMinor, 0);
  const rowWeights = slotTotals.flatMap((slotTotal) => Array.from({ length: input.quantity }, () => slotTotal));
  const weights = rowWeights.some((weight) => weight > 0) ? rowWeights : rowWeights.map(() => 1);
  return {
    version: QUOTE_VERSION,
    currency: input.currency,
    quantity: input.quantity,
    attendees: input.attendees,
    rateKinds: input.slots.map((slot) => slot.rateKind),
    addOns: input.addOns.filter((entry) => entry.quantity > 0).map((entry) => ({ id: entry.addOn.id, quantity: entry.quantity })),
    lines,
    subtotalMinor,
    taxMinor: totalMinor - subtotalMinor,
    totalMinor,
    slotTotals,
    occurrencePrices: apportion(totalMinor, weights),
    tax,
  };
}

/** The upfront deposit for a total under the rules. */
export function depositFor(totalMinor: number, rules: { depositKind: "PERCENT" | "FIXED"; depositPercentBps: number; depositFixedMinor: number }): number {
  if (totalMinor <= 0) return 0;
  if (rules.depositKind === "FIXED") return Math.min(rules.depositFixedMinor, totalMinor);
  return Math.min(totalMinor, divRoundHalfUp(BigInt(totalMinor) * BigInt(rules.depositPercentBps), 10_000));
}
