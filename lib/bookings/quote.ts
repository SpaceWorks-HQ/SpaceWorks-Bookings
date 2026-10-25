import type { RateKind, Space } from "@prisma/client";
import { loadRules } from "@/lib/availability/context";
import type { BookingRules } from "@/lib/bookingRules/schema";
import type { TaxSnapshot } from "@/lib/payments/tax";
import { priceBooking, PricingError, type Quote } from "@/lib/pricing/quote";
import { defaultDb, withTx, type DbOrTx, type Tx } from "./db";
import { BookingError, invalidInput, notFound } from "./errors";
import { loadAddOns, loadPeakRules, loadTaxSnapshot, memberRateKinds, spacePricing, type AddOnSelection } from "./pricingInputs";

/** Price slots of a space from the database (rates, peak rules, add-ons, tax). */

export type QuoteSlotsInput = {
  makerspaceId: string;
  space: Space;
  timeZone: string;
  currency: string;
  rules: BookingRules;
  slots: Array<{ start: Date; end: Date; rateKind: RateKind }>;
  quantity: number;
  attendees: number;
  addOns: AddOnSelection[];
  /** Reprice with a frozen tax snapshot (reschedules); otherwise the makerspace's current settings. */
  tax?: TaxSnapshot;
};

export async function quoteSlots(tx: Tx, input: QuoteSlotsInput): Promise<Quote> {
  const [addOns, peakRules, tax] = await Promise.all([
    loadAddOns(tx, input.makerspaceId, input.space.id, input.addOns),
    loadPeakRules(tx, input.makerspaceId, input.space.id),
    input.tax ? Promise.resolve(input.tax) : loadTaxSnapshot(tx, input.makerspaceId, input.currency),
  ]);
  // A frozen snapshot already carries the space's overrides; don't apply today's again.
  const space = input.tax ? { ...spacePricing(input.space), taxRateBps: null, sacCode: null } : spacePricing(input.space);
  try {
    return priceBooking({ currency: input.currency, timeZone: input.timeZone, space, stepMinutes: input.rules.slotStepMinutes, slots: input.slots, quantity: input.quantity, attendees: input.attendees, addOns, peakRules, tax });
  } catch (error) {
    if (error instanceof PricingError) throw new BookingError("NO_RATE", error.message);
    throw error;
  }
}

export type PreviewInput = {
  makerspaceId: string;
  spaceId: string;
  slots: Array<{ start: Date; end: Date }>;
  quantity?: number;
  attendees?: number;
  addOns?: AddOnSelection[];
  /** A verified account email or a staff-typed email: priced at member rates where it matches. */
  memberEmail?: string | null;
};

/** A price preview for the booking form (no hold needed). */
export async function previewQuote(input: PreviewInput, db: DbOrTx = defaultDb()): Promise<Quote> {
  return withTx(db, async (tx) => {
    const space = await tx.space.findFirst({ where: { id: input.spaceId, makerspaceId: input.makerspaceId, archivedAt: null } });
    if (!space) throw notFound("Space");
    if (input.slots.length === 0 || input.slots.length > 104) throw invalidInput("Choose between 1 and 104 times.");
    const makerspace = await tx.makerspace.findUniqueOrThrow({ where: { id: input.makerspaceId }, select: { timezone: true, currency: true } });
    const rules = (await loadRules(tx, input.makerspaceId, space)).values;
    const kinds = await memberRateKinds(tx, input.makerspaceId, input.memberEmail ?? null, input.slots, makerspace.timezone);
    return quoteSlots(tx, {
      makerspaceId: input.makerspaceId,
      space,
      timeZone: makerspace.timezone,
      currency: makerspace.currency,
      rules,
      slots: input.slots.map((slot, index) => ({ ...slot, rateKind: kinds[index] })),
      quantity: input.quantity ?? 1,
      attendees: input.attendees ?? 1,
      addOns: input.addOns ?? [],
    });
  });
}
