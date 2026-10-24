import { describe, expect, it } from "vitest";
import { resolveTaxSnapshot, type TaxSnapshot } from "@/lib/payments/tax";
import { depositFor, priceBooking, PricingError, spaceTaxSnapshot, type QuoteInput, type SpacePricing } from "@/lib/pricing/quote";

const gstSettings = { mode: "GST" as const, scheme: "REGULAR" as const, gstin: "32ABCDE1234F1Z5", legalName: "Tinkerspace", address: "Alappuzha", stateCode: "KL", sacCode: "997212", rateBps: 1800, inclusive: true, exempt: false, foreignCurrencyTax: "NO_TAX" as const, lutNumber: null, simpleTaxName: "Tax" };
const GST_INCLUSIVE = resolveTaxSnapshot(gstSettings, "INR");
const GST_EXCLUSIVE = resolveTaxSnapshot({ ...gstSettings, inclusive: false }, "INR");
const NO_TAX = resolveTaxSnapshot(null, "INR");

const studio: SpacePricing = { name: "Studio A", publicHourlyMinor: 50_000, publicHalfDayMinor: 160_000, publicDayMinor: 280_000, memberHourlyMinor: 40_000, memberHalfDayMinor: null, memberDayMinor: null, halfDayMinutes: 240, dayMinutes: 480, taxRateBps: null, sacCode: null };
const monday = (from: string, to: string) => ({ start: new Date(`2026-11-02T${from}:00+05:30`), end: new Date(`2026-11-02T${to}:00+05:30`), rateKind: "PUBLIC" as const });

function input(over: Partial<QuoteInput> = {}): QuoteInput {
  return { currency: "INR", timeZone: "Asia/Kolkata", space: studio, stepMinutes: 30, slots: [monday("10:00", "12:00")], quantity: 1, attendees: 2, addOns: [], peakRules: [], tax: NO_TAX, ...over };
}

describe("priceBooking", () => {
  it("prices one slot without tax", () => {
    const quote = priceBooking(input());
    expect(quote.totalMinor).toBe(100_000);
    expect(quote.subtotalMinor).toBe(100_000);
    expect(quote.taxMinor).toBe(0);
    expect(quote.lines).toHaveLength(1);
    expect(quote.lines[0]).toMatchObject({ kind: "SPACE", paymentKind: "BOOKING", slotIndex: 0, listedMinor: 100_000, detail: "2 h", sac: null });
    expect(quote.lines[0].description).toBe("Studio A, 2 Nov 2026, 10:00 AM to 12:00 PM");
    expect(quote.occurrencePrices).toEqual([100_000]);
  });

  it("splits inclusive GST into equal CGST and SGST: the place of supply is the makerspace's own state", () => {
    const quote = priceBooking(input({ tax: GST_INCLUSIVE }));
    const [line] = quote.lines;
    expect(line.amountMinor).toBe(100_000);
    expect(line.cgstMinor).toBe(line.sgstMinor);
    expect(line.igstMinor).toBe(0);
    expect(line.taxableMinor + line.cgstMinor + line.sgstMinor).toBe(100_000);
    expect(line.sac).toBe("997212");
    expect(quote.taxMinor).toBe(line.cgstMinor * 2);
  });

  it("adds exclusive GST on top", () => {
    const quote = priceBooking(input({ tax: GST_EXCLUSIVE }));
    expect(quote.subtotalMinor).toBe(100_000);
    expect(quote.taxMinor).toBe(18_000);
    expect(quote.totalMinor).toBe(118_000);
  });

  it("applies the space's tax rate and SAC overrides only where tax applies", () => {
    const space = { ...studio, taxRateBps: 500, sacCode: "997213" };
    const quote = priceBooking(input({ space, tax: GST_EXCLUSIVE }));
    expect(quote.taxMinor).toBe(5000);
    expect(quote.tax.sac).toBe("997213");
    expect(spaceTaxSnapshot(NO_TAX, space)).toEqual(NO_TAX);
    const composition = resolveTaxSnapshot({ ...gstSettings, scheme: "COMPOSITION" }, "INR");
    expect(spaceTaxSnapshot(composition, space).rateBps).toBe(0);
    const simple: TaxSnapshot = resolveTaxSnapshot({ ...gstSettings, mode: "SIMPLE", rateBps: 2000, inclusive: false }, "GBP");
    expect(priceBooking(input({ currency: "GBP", space, tax: simple })).lines[0]).toMatchObject({ otherTaxMinor: 5000, cgstMinor: 0, sac: null });
  });

  it("uses member rates per slot", () => {
    const quote = priceBooking(input({ slots: [{ ...monday("10:00", "12:00"), rateKind: "MEMBER" }, { ...monday("14:00", "16:00"), rateKind: "PUBLIC" }] }));
    expect(quote.slotTotals).toEqual([80_000, 100_000]);
    expect(quote.lines[0].detail).toBe("2 h, member rate");
    expect(quote.rateKinds).toEqual(["MEMBER", "PUBLIC"]);
  });

  it("multiplies by quantity and splits each slot across its units", () => {
    const quote = priceBooking(input({ quantity: 3 }));
    expect(quote.totalMinor).toBe(300_000);
    expect(quote.lines[0].detail).toBe("2 h × 3");
    expect(quote.occurrencePrices).toEqual([100_000, 100_000, 100_000]);
  });

  it("adds peak surcharges per rule", () => {
    const peakRules = [{ id: "eve", name: "Evening rate", weekdays: [1], startMinute: 17 * 60, endMinute: 22 * 60, surchargeBps: 5000 }];
    const quote = priceBooking(input({ slots: [monday("16:00", "18:00")], peakRules }));
    const peak = quote.lines.find((line) => line.kind === "PEAK")!;
    expect(peak).toMatchObject({ refId: "eve", listedMinor: 25_000, slotIndex: 0, detail: "60 min at +50%" });
    expect(quote.totalMinor).toBe(125_000);
  });

  it("prices add-ons per booking, per hour and per person, with member prices", () => {
    const addOns = [
      { addOn: { id: "proj", name: "Projector", unit: "PER_BOOKING" as const, priceMinor: 30_000, memberPriceMinor: 20_000, sacCode: null }, quantity: 1 },
      { addOn: { id: "tech", name: "Technician", unit: "PER_HOUR" as const, priceMinor: 45_000, memberPriceMinor: null, sacCode: "998596" }, quantity: 1 },
      { addOn: { id: "tea", name: "Tea", unit: "PER_PERSON" as const, priceMinor: 3000, memberPriceMinor: 5000, sacCode: null }, quantity: 1 },
    ];
    const quote = priceBooking(input({ attendees: 4, addOns, slots: [{ ...monday("10:00", "11:30"), rateKind: "MEMBER" }], tax: GST_INCLUSIVE }));
    const amounts = Object.fromEntries(quote.lines.map((line) => [line.refId ?? line.kind, line.listedMinor]));
    expect(amounts).toEqual({ SPACE: 60_000, tech: 67_500, tea: 12_000, proj: 20_000 });
    expect(quote.lines.find((line) => line.refId === "proj")!.slotIndex).toBeNull();
    expect(quote.lines.find((line) => line.refId === "tech")!.sac).toBe("998596");
    expect(quote.addOns).toEqual([{ id: "proj", quantity: 1 }, { id: "tech", quantity: 1 }, { id: "tea", quantity: 1 }]);
    expect(quote.totalMinor).toBe(159_500);
  });

  it("refuses a duration the space has no rate for", () => {
    expect(() => priceBooking(input({ space: { ...studio, publicHourlyMinor: null, publicHalfDayMinor: null, publicDayMinor: null } }))).toThrow(PricingError);
  });

  it("is free when every rate is zero", () => {
    const free = { ...studio, publicHourlyMinor: 0, publicHalfDayMinor: null, publicDayMinor: null };
    const quote = priceBooking(input({ space: free, slots: [monday("10:00", "11:00"), monday("12:00", "13:00")] }));
    expect(quote.totalMinor).toBe(0);
    expect(quote.occurrencePrices).toEqual([0, 0]);
  });

  it("shares the total across occurrence rows exactly, booking-level add-ons included (property)", () => {
    for (let count = 1; count <= 9; count += 1) {
      for (const quantity of [1, 2, 3]) {
        const slots = Array.from({ length: count }, (_, index) => ({ start: new Date(Date.parse("2026-11-02T04:30:00Z") + index * 86_400_000), end: new Date(Date.parse("2026-11-02T04:30:00Z") + index * 86_400_000 + (30 + 30 * index) * 60_000), rateKind: "PUBLIC" as const }));
        const addOns = [{ addOn: { id: "fee", name: "Setup", unit: "PER_BOOKING" as const, priceMinor: 10_001, memberPriceMinor: null, sacCode: null }, quantity: 1 }];
        const quote = priceBooking(input({ slots, quantity, addOns, tax: GST_INCLUSIVE, space: { ...studio, publicHourlyMinor: 33_333 } }));
        expect(quote.occurrencePrices).toHaveLength(count * quantity);
        expect(quote.occurrencePrices.reduce((sum, price) => sum + price, 0)).toBe(quote.totalMinor);
        expect(quote.lines.reduce((sum, line) => sum + line.taxableMinor + line.cgstMinor + line.sgstMinor, 0)).toBe(quote.totalMinor);
      }
    }
  });
});

describe("depositFor", () => {
  it("takes a percentage, half up, or a fixed amount capped at the total", () => {
    expect(depositFor(100_001, { depositKind: "PERCENT", depositPercentBps: 5000, depositFixedMinor: 0 })).toBe(50_001);
    expect(depositFor(50_000, { depositKind: "FIXED", depositPercentBps: 0, depositFixedMinor: 80_000 })).toBe(50_000);
    expect(depositFor(0, { depositKind: "FIXED", depositPercentBps: 0, depositFixedMinor: 80_000 })).toBe(0);
  });
});
