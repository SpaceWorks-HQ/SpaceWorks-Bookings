import { describe, expect, it } from "vitest";
import { gstDate, gstPeriod, gstr1Json } from "@/lib/reports/finance/gstr1Json";
import type { Gstr1 } from "@/lib/reports/finance/gst";

const zero = { taxable: 0, igst: 0, cgst: 0, sgst: 0 };
const report: Gstr1 = {
  b2b: [{ number: "KRC-2627-00003", issuedAt: new Date("2026-04-10T06:00:00Z"), gstin: "29ABCDE1234F1Z5", value: 118_000, placeOfSupply: "KA", rateBps: 1800, taxable: 100_000, igst: 18_000, cgst: 0, sgst: 0 }],
  b2cl: [],
  b2cs: [{ placeOfSupply: "KL", rateBps: 1800, supplyType: "INTRA", taxable: 200_000, igst: 0, cgst: 18_000, sgst: 18_000 }],
  nilExempt: { inter: 0, intra: 5_000 },
  cdnr: [],
  cdnur: [],
  hsnB2b: [{ sac: "999599", rateBps: 1800, uqc: "NA", quantity: 0, taxable: 100_000, igst: 18_000, cgst: 0, sgst: 0 }],
  hsnB2c: [{ sac: "999599", rateBps: 1800, uqc: "NA", quantity: 0, taxable: 200_000, igst: 0, cgst: 18_000, sgst: 18_000 }],
  totals: zero,
};

describe("GSTR-1 JSON", () => {
  const documents = [
    { nature: "Invoices for outward supply", series: "R", from: "KRC-2627-00001", to: "KRC-2627-00009", total: 9, cancelled: 1, netIssued: 8 },
    { nature: "Receipt voucher", series: "N", from: "KRC-2627-N00001", to: "KRC-2627-N00002", total: 2, cancelled: 0, netIssued: 2 },
    { nature: "Credit note", series: "C", from: "KRC-2627-C00001", to: "KRC-2627-C00001", total: 1, cancelled: 0, netIssued: 1 },
  ];
  const json = gstr1Json(report, { gstin: "32ABCDE1234F1Z5", period: gstPeriod({ year: 2026, month: 4 }), supplierState: "KL", timeZone: "Asia/Kolkata", documents });

  it("names the registration and period in the offline tool's envelope", () => {
    expect(json).toMatchObject({ gstin: "32ABCDE1234F1Z5", fp: "042026", version: "GST3.2.4", hash: "hash" });
  });

  it("keeps the B2CL place of supply on the group only, and leaves out an empty Table 13", () => {
    const empty = gstr1Json(report, { gstin: "32ABCDE1234F1Z5", period: "042026", supplierState: "KL", timeZone: "Asia/Kolkata", documents: [] });
    expect(empty).not.toHaveProperty("doc_issue");
    expect(Object.keys(json).slice(-2)).toEqual(["doc_issue", "hsn"]);
    const b2cl = gstr1Json({ ...report, b2cl: [{ ...report.b2b[0], gstin: null, value: 11_800_000, taxable: 10_000_000, igst: 1_800_000 }] }, { gstin: "32ABCDE1234F1Z5", period: "042026", supplierState: "KL", timeZone: "Asia/Kolkata", documents: [] }).b2cl;
    expect(b2cl).toEqual([{ pos: "29", inv: [{ inum: "KRC-2627-00003", idt: "10-04-2026", val: 118000, itms: [{ num: 1801, itm_det: { txval: 100000, rt: 18, iamt: 18000, csamt: 0 } }] }] }]);
  });

  it("lists Table 13 under the portal's document codes, leaving out non-GST receipts", () => {
    expect(json.doc_issue).toEqual({ doc_det: [
      { doc_num: 1, docs: [{ num: 1, from: "KRC-2627-00001", to: "KRC-2627-00009", totnum: 9, cancel: 1, net_issue: 8 }] },
      { doc_num: 5, docs: [{ num: 1, from: "KRC-2627-C00001", to: "KRC-2627-C00001", totnum: 1, cancel: 0, net_issue: 1 }] },
    ] });
  });

  it("groups B2B invoices by buyer with rupee amounts, GST state codes and dd-mm-yyyy dates", () => {
    expect(json.b2b).toEqual([{ ctin: "29ABCDE1234F1Z5", inv: [{ inum: "KRC-2627-00003", idt: "10-04-2026", val: 1180, pos: "29", rchrg: "N", inv_typ: "R", itms: [{ num: 1801, itm_det: { txval: 1000, rt: 18, iamt: 180, csamt: 0 } }] }] }]);
  });

  it("splits intra-state B2C small supplies into CGST and SGST", () => {
    expect(json.b2cs).toEqual([{ sply_ty: "INTRA", pos: "32", typ: "OE", rt: 18, txval: 2000, camt: 180, samt: 180, csamt: 0 }]);
    expect(json.nil.inv[1]).toMatchObject({ sply_ty: "INTRAB2C", expt_amt: 50 });
    expect(json.hsn.hsn_b2c[0]).toMatchObject({ hsn_sc: "999599", uqc: "NA", rt: 18, txval: 2000, camt: 180 });
  });

  it("formats dates in the organisation's timezone", () => {
    expect(gstDate(new Date("2026-04-30T20:00:00Z"), "Asia/Kolkata")).toBe("01-05-2026");
  });
});
