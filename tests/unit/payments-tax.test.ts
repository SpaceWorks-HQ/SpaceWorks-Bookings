import { describe, expect, it } from "vitest";
import { apportion, chargeLines, creditNoteLines, placeOfSupply, resolveTaxSnapshot, splitTax, sumSplits, type TaxSnapshot } from "@/lib/payments/tax";
import { formatDocumentNumber, RECEIPT_PREFIX_PATTERN } from "@/lib/payments/numbering";

const gstSettings: Parameters<typeof resolveTaxSnapshot>[0] & object = {
  mode: "GST", scheme: "REGULAR", gstin: "32ABCDE1234F1Z5", legalName: "SpaceWorks Club", address: "Kochi", stateCode: "KL",
  sacCode: "999599", rateBps: 1800, inclusive: true, exempt: false, foreignCurrencyTax: "NO_TAX", lutNumber: null, simpleTaxName: "Tax",
};

const gst = (overrides: Partial<typeof gstSettings> = {}) => resolveTaxSnapshot({ ...gstSettings, ...overrides }, "INR");

describe("resolveTaxSnapshot", () => {
  it("issues plain receipts when there is no tax", () => {
    expect(resolveTaxSnapshot(null, "INR")).toMatchObject({ mode: "NONE", documentKind: "RECEIPT", rateBps: 0 });
  });

  it("issues tax invoices for regular GST and bills of supply for composition or exempt", () => {
    expect(gst()).toMatchObject({ documentKind: "TAX_INVOICE", rateBps: 1800, sac: "999599" });
    expect(gst({ scheme: "COMPOSITION" })).toMatchObject({ documentKind: "BILL_OF_SUPPLY", rateBps: 0 });
    expect(gst({ exempt: true })).toMatchObject({ documentKind: "BILL_OF_SUPPLY", rateBps: 0 });
  });

  it("zero-rates foreign-currency plans under LUT, or keeps them outside GST", () => {
    expect(resolveTaxSnapshot({ ...gstSettings, foreignCurrencyTax: "EXPORT_LUT", lutNumber: "AD3203" }, "USD")).toMatchObject({ documentKind: "TAX_INVOICE", rateBps: 0, zeroRatedExport: true, lutNumber: "AD3203" });
    expect(resolveTaxSnapshot(gstSettings, "USD")).toMatchObject({ documentKind: "RECEIPT", rateBps: 0 });
  });

  it("uses the named tax in simple mode", () => {
    expect(resolveTaxSnapshot({ ...gstSettings, mode: "SIMPLE", simpleTaxName: "VAT", rateBps: 500, inclusive: false }, "AED")).toMatchObject({ mode: "SIMPLE", taxName: "VAT", rateBps: 500, inclusive: false, documentKind: "RECEIPT" });
  });
});

describe("splitTax", () => {
  it("backs tax out of an inclusive price, splitting CGST and SGST within the state", () => {
    const split = splitTax(118_000, gst(), "KL");
    expect(split).toEqual({ amountMinor: 118_000, taxableMinor: 100_000, cgstMinor: 9_000, sgstMinor: 9_000, igstMinor: 0, otherTaxMinor: 0 });
  });

  it("charges IGST to members in another state", () => {
    expect(splitTax(118_000, gst(), "TN")).toMatchObject({ taxableMinor: 100_000, igstMinor: 18_000, cgstMinor: 0, sgstMinor: 0 });
  });

  it("moves an odd paisa into the taxable value so the halves match and the total holds", () => {
    const split = splitTax(100_001, gst(), "KL");
    expect(split.cgstMinor).toBe(split.sgstMinor);
    expect(split.taxableMinor + split.cgstMinor + split.sgstMinor).toBe(100_001);
    expect((split.cgstMinor + split.sgstMinor) % 2).toBe(0);
  });

  it("adds tax on top of an exclusive price", () => {
    expect(splitTax(100_000, gst({ inclusive: false }), "KL")).toMatchObject({ amountMinor: 118_000, taxableMinor: 100_000, cgstMinor: 9_000 });
  });

  it("leaves untaxed charges alone", () => {
    expect(splitTax(50_000, resolveTaxSnapshot(null, "INR"), null)).toMatchObject({ amountMinor: 50_000, taxableMinor: 50_000, cgstMinor: 0, igstMinor: 0 });
  });

  it("puts simple-mode tax in its own column", () => {
    const snapshot = resolveTaxSnapshot({ ...gstSettings, mode: "SIMPLE", rateBps: 500, inclusive: false }, "AED");
    expect(splitTax(10_000, snapshot, null)).toMatchObject({ amountMinor: 10_500, otherTaxMinor: 500, cgstMinor: 0 });
  });

  it("falls back to the supplier's state for place of supply", () => {
    expect(placeOfSupply(null, { supplierState: "KL" })).toBe("KL");
    expect(placeOfSupply("MH", { supplierState: "KL" })).toBe("MH");
  });
});

describe("charges and credit notes", () => {
  const snapshot: TaxSnapshot = gst();
  const lines = chargeLines([{ kind: "BOOKING", description: "Laser studio", amountMinor: 118_000 }, { kind: "ADD_ON", description: "Projector", amountMinor: 59_000 }], snapshot, "KL");

  it("charges each item as a separate taxed line", () => {
    expect(lines.map((line) => [line.kind, line.amountMinor])).toEqual([["BOOKING", 118_000], ["ADD_ON", 59_000]]);
    expect(sumSplits(lines).amountMinor).toBe(177_000);
  });

  it("apportions exactly, largest remainder first", () => {
    expect(apportion(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(apportion(0, [5, 5])).toEqual([0, 0]);
    expect(apportion(10, [0, 0])).toEqual([0, 0]);
  });

  it("reverses a full refund exactly", () => {
    const credit = creditNoteLines(lines, 177_000);
    expect(sumSplits(credit)).toEqual(sumSplits(lines));
  });

  it("shares a partial refund's tax pro rata and adds up to the refund", () => {
    const credit = creditNoteLines(lines, 50_001);
    const totals = sumSplits(credit);
    expect(totals.amountMinor).toBe(50_001);
    expect(totals.taxableMinor + totals.cgstMinor + totals.sgstMinor + totals.igstMinor + totals.otherTaxMinor).toBe(50_001);
    for (const line of credit) expect(line.taxableMinor + line.cgstMinor + line.sgstMinor).toBe(line.amountMinor);
  });
});

describe("credit notes across several partial refunds", () => {
  const lines = chargeLines([{ kind: "BOOKING", description: "Tiny", amountMinor: 1_180 }], gst(), "KL");

  it("keeps CGST and SGST equal on every credit note", () => {
    for (const amount of [1, 6, 7, 59, 590, 1_179]) {
      for (const line of creditNoteLines(lines, amount)) expect(line.cgstMinor).toBe(line.sgstMinor);
    }
  });

  it("adds up to the invoice however the refund is split", () => {
    const steps = [6, 7, 300, 867];
    let credited = 0;
    const notes = steps.map((amount) => {
      const note = creditNoteLines(lines, amount, credited);
      credited += amount;
      return sumSplits(note);
    });
    expect(sumSplits(notes)).toEqual(sumSplits(lines));
  });
});

describe("document numbers", () => {
  it("formats payment documents and credit notes within 16 characters", () => {
    expect(formatDocumentNumber("SWO", "R", "2026-27", 42)).toBe("SWO-2627-00042");
    expect(formatDocumentNumber("SWOR", "C", "2026-27", 99_999)).toBe("SWOR-2627-C99999");
    expect(formatDocumentNumber("", "R", "2026", 1)).toBe("2026-00001");
    expect(formatDocumentNumber("SWOR", "C", "2026-27", 1).length).toBeLessThanOrEqual(16);
    expect(formatDocumentNumber("SWOR", "C", "2026-27", 100_000)).toBe("SWOR2627-C100000");
    expect(formatDocumentNumber("SWOR", "C", "2026-27", 1_000_000).length).toBeLessThanOrEqual(16);
  });

  it("limits prefixes to four letters or digits", () => {
    expect(RECEIPT_PREFIX_PATTERN.test("AB12")).toBe(true);
    expect(RECEIPT_PREFIX_PATTERN.test("ABCDE")).toBe(false);
    expect(RECEIPT_PREFIX_PATTERN.test("ab")).toBe(false);
  });
});

describe("charge items", () => {
  it("keeps each item's wording and skips zero amounts", () => {
    const lines = chargeLines([{ kind: "BOOKING", description: "Hot desk, 2 hours", amountMinor: 1_000 }, { kind: "ADD_ON", description: "Locker", amountMinor: 0 }], gst(), "KL");
    expect(lines.map((line) => line.description)).toEqual(["Hot desk, 2 hours"]);
  });
});
