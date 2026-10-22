import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { documentAmount, renderDocumentPdf } = await import("@/lib/payments/pdf");
type Snapshot = Parameters<typeof renderDocumentPdf>[0];

const snapshot: Snapshot = {
  kind: "TAX_INVOICE",
  number: "KUNJ-2627-00001",
  issuedAt: "2026-06-15T06:00:00.000Z",
  financialYear: "2026-27",
  currency: "INR",
  locale: null,
  timeZone: "Asia/Kolkata",
  issuer: { name: "Kunj-Company", legalName: "Kunj Company Society", gstin: "32ABCDE1234F1Z5", address: "Kochi", state: "KL", email: "hello@kunj.example", logoUrl: null },
  recipient: { name: "ഷാൻ Shoukath", memberNumber: 1, state: "KL", gstin: null },
  placeOfSupply: "KL",
  sac: "999599",
  tax: { mode: "GST", rateBps: 1800, inclusive: true, taxName: "GST", zeroRatedExport: false, lutNumber: null },
  lines: [{ description: "Annual membership", amountMinor: 118_000, taxableMinor: 100_000, cgstMinor: 9_000, sgstMinor: 9_000, igstMinor: 0, otherTaxMinor: 0 }],
  totals: { amountMinor: 118_000, taxableMinor: 100_000, cgstMinor: 9_000, sgstMinor: 9_000, igstMinor: 0, otherTaxMinor: 0 },
  payment: { provider: "OFFLINE", method: "upi", reference: "612345678901", paidAt: "2026-06-15T06:00:00.000Z" },
  membership: { plan: "Annual", startsAt: "2026-06-14T18:30:00.000Z", endsAt: "2027-03-31T18:30:00.000Z" },
  original: null,
};

describe("tax document PDF", () => {
  it("renders a PDF from the snapshot, even with characters the font lacks", async () => {
    const bytes = await renderDocumentPdf(snapshot);
    expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(2_000);
  });

  it("renders credit notes and untaxed receipts", async () => {
    const credit = await renderDocumentPdf({ ...snapshot, kind: "CREDIT_NOTE", number: "KUNJ-2627-C00001", original: { number: "KUNJ-2627-00001", issuedAt: snapshot.issuedAt } });
    const receipt = await renderDocumentPdf({ ...snapshot, kind: "RECEIPT", tax: { ...snapshot.tax, mode: "NONE", rateBps: 0 }, placeOfSupply: null });
    expect(credit.length).toBeGreaterThan(2_000);
    expect(receipt.length).toBeGreaterThan(2_000);
  });

  it("writes amounts with the currency code and the right decimals", () => {
    expect(documentAmount(118_000, "INR", null)).toBe("INR 1,180.00");
    expect(documentAmount(12_345, "KWD", null)).toBe("KWD 12.345");
    expect(documentAmount(5000, "JPY", null)).toBe("JPY 5,000");
  });
});
