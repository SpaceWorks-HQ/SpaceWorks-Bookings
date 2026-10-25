import { describe, expect, it } from "vitest";
import { B2CL_THRESHOLD_MINOR, gstr1, gstr3b, isInterState, monthlyLiability, simpleTaxSummary } from "@/lib/reports/finance/gst";
import { seriesChecks, table13 } from "@/lib/reports/finance/documents";
import { periodBuckets, resolvePeriod } from "@/lib/reports/period";
import { at, doc, refund } from "../helpers/financeFixtures";

const MAY = { from: at("2026-05-01"), to: at("2026-06-01") };

describe("documents register (B6)", () => {
  it("passes a gapless series and flags gaps and repeats", () => {
    const [ok] = seriesChecks([doc("a", 1), doc("b", 2), doc("c", 3, { cancelledAt: at("2026-05-11") })]);
    expect(ok).toMatchObject({ series: "INV", financialYear: "2026-27", issued: 3, cancelled: 1, gaps: [], duplicates: [] });
    const [bad] = seriesChecks([doc("a", 2), doc("b", 2), doc("c", 5)]);
    expect(bad.gaps).toEqual([1, 3, 4]);
    expect(bad.duplicates).toEqual([2]);
  });

  it("checks each series and year separately", () => {
    const checks = seriesChecks([doc("a", 1), doc("b", 1, { financialYear: "2025-26" }), doc("c", 1, { series: "CN", kind: "CREDIT_NOTE" })]);
    expect(checks.map((check) => `${check.series} ${check.financialYear}`)).toEqual(["CN 2026-27", "INV 2026-27", "INV 2025-26"]);
  });

  it("fills GSTR-1 Table 13 per nature and series", () => {
    const rows = table13([doc("a", 1), doc("b", 2, { cancelledAt: at("2026-05-12") }), doc("c", 3, { issuedAt: at("2026-06-02") }), doc("n", 1, { kind: "CREDIT_NOTE", series: "CN", number: "CN/2026-27/0001" })], MAY);
    expect(rows).toEqual([
      { nature: "Credit note", series: "CN", from: "CN/2026-27/0001", to: "CN/2026-27/0001", total: 1, cancelled: 0, netIssued: 1 },
      { nature: "Invoices for outward supply", series: "INV", from: "INV/2026-27/0001", to: "INV/2026-27/0002", total: 2, cancelled: 1, netIssued: 1 },
    ]);
  });
});

describe("GSTR-1 and GSTR-3B (B7)", () => {
  const interLarge = doc("big", 2, { placeOfSupply: "TN", igstMinor: 1_800_000, cgstMinor: 0, sgstMinor: 0, taxableMinor: 10_000_000, totalMinor: 11_800_000 });
  const interSmall = doc("small", 3, { placeOfSupply: "KA", igstMinor: 18_000, cgstMinor: 0, sgstMinor: 0 });
  const b2b = doc("firm", 4, { recipientGstin: "32AAAAA0000A1Z5" });
  const cancelled = doc("void", 5, { cancelledAt: at("2026-05-11") });
  const usd = doc("usd", 6, { currency: "USD" });
  const exempt = doc("bos", 7, { kind: "BILL_OF_SUPPLY", cgstMinor: 0, sgstMinor: 0, totalMinor: 50_000, taxableMinor: 50_000, rateBps: 0 });
  const creditSmall = doc("cn1", 1, { kind: "CREDIT_NOTE", series: "CN", paymentId: null, refundId: "r1", taxableMinor: 10_000, cgstMinor: 900, sgstMinor: 900, totalMinor: 11_800 });
  const docs = [doc("intra", 1), interLarge, interSmall, b2b, cancelled, usd, exempt, creditSmall];
  const refunds = [refund("r1", "pay-intra", 11_800)];
  const r1 = gstr1(docs, refunds, MAY, "KL");

  it("routes invoices to B2B, B2C large (inter-state over ₹1 lakh) and B2C others", () => {
    expect(B2CL_THRESHOLD_MINOR).toBe(10_000_000);
    expect(r1.b2b.map((row) => row.number)).toEqual([b2b.number]);
    expect(r1.b2cl.map((row) => row.number)).toEqual([interLarge.number]);
    // Exactly ₹1 lakh is not "over" it: B2C others.
    const atThreshold = gstr1([{ ...interLarge, totalMinor: B2CL_THRESHOLD_MINOR }], [], MAY, "KL");
    expect([atThreshold.b2cl.length, atThreshold.b2cs.length]).toEqual([0, 1]);
    expect(isInterState({ igstMinor: 0, placeOfSupply: "TN" }, "KL")).toBe(true);
  });

  it("aggregates B2C others by place of supply and rate, net of their credit notes, ignoring cancelled and non-INR", () => {
    expect(r1.b2cs).toEqual([
      { placeOfSupply: "KA", rateBps: 1800, supplyType: "INTER", taxable: 100_000, igst: 18_000, cgst: 0, sgst: 0 },
      { placeOfSupply: "KL", rateBps: 1800, supplyType: "INTRA", taxable: 90_000, igst: 0, cgst: 8_100, sgst: 8_100 },
    ]);
    expect(r1.cdnr).toEqual([]);
    expect(r1.nilExempt).toEqual({ inter: 0, intra: 50_000 });
  });

  it("splits the SAC summary into B2B and B2C rows with UQC NA", () => {
    expect(r1.hsnB2b).toEqual([{ sac: "997212", rateBps: 1800, uqc: "NA", quantity: 0, taxable: 100_000, igst: 0, cgst: 9_000, sgst: 9_000 }]);
    expect(r1.hsnB2c[0]).toMatchObject({ taxable: 10_190_000, igst: 1_818_000, cgst: 8_100, sgst: 8_100 });
  });

  it("puts credit notes for registered members in CDNR", () => {
    const withB2b = gstr1([b2b, { ...creditSmall, refundId: "r2" }], [refund("r2", b2b.paymentId!, 11_800)], MAY, "KL");
    expect(withB2b.cdnr).toHaveLength(1);
    expect(withB2b.cdnr[0]).toMatchObject({ gstin: b2b.recipientGstin, againstNumber: b2b.number });
  });

  it("summarises GSTR-3B 3.1(a), 3.1(c) and 3.2", () => {
    const r3 = gstr3b(docs, refunds, MAY, "KL");
    expect(r3.outwardTaxable).toEqual({ taxable: 10_290_000, igst: 1_818_000, cgst: 17_100, sgst: 17_100 });
    expect(r3.nilExempt).toBe(50_000);
    expect(r3.interStateUnregistered).toEqual([{ placeOfSupply: "KA", taxable: 100_000, igst: 18_000 }, { placeOfSupply: "TN", taxable: 10_000_000, igst: 1_800_000 }]);
  });

  it("shows liability month by month and SIMPLE tax per currency", () => {
    const buckets = periodBuckets(resolvePeriod({ period: "custom", from: "2026-05-01", to: "2026-06-30" }, { timezone: "Asia/Kolkata", financialYearStartMonth: 4 }, at("2026-10-01")), "Asia/Kolkata", "month");
    expect(monthlyLiability([doc("a", 1), doc("b", 2, { issuedAt: at("2026-06-03") })], buckets).map((row) => row.cgst)).toEqual([9_000, 9_000]);
    const vat = simpleTaxSummary([doc("v", 1, { currency: "AED", cgstMinor: 0, sgstMinor: 0, otherTaxMinor: 500, rateBps: 500 }), doc("w", 2, { currency: "AED", kind: "CREDIT_NOTE", cgstMinor: 0, sgstMinor: 0, otherTaxMinor: 100, taxableMinor: 2_000, rateBps: 500 })], MAY, "INR");
    expect(vat).toEqual([{ currency: "AED", rateBps: 500, taxable: 98_000, tax: 400, documents: 2 }]);
  });
});

describe("credit notes follow their original document", () => {
  const exempt = doc("bos", 1, { kind: "BILL_OF_SUPPLY", paymentId: "pay-bos", cgstMinor: 0, sgstMinor: 0, totalMinor: 50_000, taxableMinor: 50_000, rateBps: 0 });
  const plain = doc("rcpt", 2, { kind: "RECEIPT", paymentId: "pay-rcpt", cgstMinor: 0, sgstMinor: 0, totalMinor: 40_000, taxableMinor: 40_000, rateBps: 0 });
  const againstExempt = doc("cn-bos", 1, { kind: "CREDIT_NOTE", series: "CN", paymentId: "pay-bos", cgstMinor: 0, sgstMinor: 0, totalMinor: 20_000, taxableMinor: 20_000, rateBps: 0 });
  const againstReceipt = doc("cn-rcpt", 2, { kind: "CREDIT_NOTE", series: "CN", paymentId: "pay-rcpt", cgstMinor: 0, sgstMinor: 0, totalMinor: 10_000, taxableMinor: 10_000, rateBps: 0 });
  const r1 = gstr1([exempt, plain, againstExempt, againstReceipt], [], MAY, "KL");

  it("reduces nil/exempt for a bill of supply and leaves taxable supplies alone", () => {
    expect(r1.nilExempt.intra).toBe(30_000);
    expect(r1.totals).toEqual({ taxable: 0, igst: 0, cgst: 0, sgst: 0 });
    expect(r1.b2cs).toEqual([]);
    expect(r1.hsnB2c).toEqual([]);
  });

  it("keeps them out of the monthly tax liability", () => {
    const buckets = periodBuckets(resolvePeriod({ period: "custom", from: "2026-05-01", to: "2026-05-31" }, { timezone: "Asia/Kolkata", financialYearStartMonth: 4 }, at("2026-06-15")), "Asia/Kolkata", "month");
    expect(monthlyLiability([exempt, plain, againstExempt, againstReceipt], buckets).every((row) => row.taxable === 0)).toBe(true);
  });
});
