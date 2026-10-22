import "server-only";
import { prisma } from "@/lib/db";

import type { ReportContext } from "../context";
import { csvAmount } from "../money";
import { periodBuckets } from "../period";
import { documentsIn, table13 } from "../finance/documents";
import { gstr1 } from "../finance/gst";
import { outstandingItems } from "../finance/outstanding";
import { collectedPayments, windowRefunds } from "../finance/revenue";
import { loadFinanceRows, loadRefunds, loadTaxDocuments } from "../finance/source";
import type { Built } from "./membership";

const iso = (date: Date | null) => (date ? date.toISOString() : "");

/** B5: collected payments and processed refunds in the period, one row each, money in its own currency. */
export async function revenueExport(ctx: ReportContext): Promise<Built> {
  const rows = await loadFinanceRows(ctx.scope);
  const plan = new Map(ctx.plans.map((p) => [p.id, p.name]));
  return {
    header: ["Type", "Payment id", "Member id", "Plan", "Provider", "Method", "Currency", "Amount", "Date"],
    rows: [
      ...collectedPayments(rows, ctx.period).map((p) => ["Payment", p.id, p.memberId, p.planId ? plan.get(p.planId) ?? "" : "", p.provider, p.method ?? "", p.currency, csvAmount(p.amountMinor, p.currency), iso(p.paidAt)]),
      ...windowRefunds(rows, ctx.period).map((r) => ["Refund", r.paymentId, "", "", "", "", r.currency, csvAmount(-r.amountMinor, r.currency), iso(r.processedAt ?? r.createdAt)]),
    ],
  };
}

/** B9: everything owed now, with age. */
export async function outstandingExport(ctx: ReportContext): Promise<Built> {
  const rows = await loadFinanceRows(ctx.scope);
  const plan = new Map(ctx.plans.map((p) => [p.id, p.name]));
  // Age payments from their term's due date, exactly as the Money page does.
  const termIds = [...new Set(rows.payments.flatMap((payment) => (payment.termId ? [payment.termId] : [])))];
  const dueBy = new Map((await prisma.membershipTerm.findMany({ where: { organisationId: ctx.org.id, id: { in: termIds } }, select: { id: true, paymentDueBy: true } })).map((term) => [term.id, term.paymentDueBy]));
  return {
    header: ["Kind", "Id", "Member id", "Plan", "Status", "Currency", "Amount", "Due", "Days past due", "Age band"],
    rows: outstandingItems(rows, ctx.now, dueBy).map((item) => [item.kind, item.id, item.memberId, item.planId ? plan.get(item.planId) ?? "" : "", item.status, item.currency, csvAmount(item.amountMinor, item.currency), iso(item.dueAt), item.daysPastDue, item.bucket]),
  };
}

/** B6: the documents register for the period. */
export async function documentsExport(ctx: ReportContext): Promise<Built> {
  const docs = documentsIn(await loadTaxDocuments(ctx.scope), ctx.period);
  return {
    header: ["Number", "Series", "Financial year", "Kind", "Issued", "Cancelled", "Currency", "Taxable", "CGST", "SGST", "IGST", "Other tax", "Total", "Rate %", "Place of supply", "Recipient GSTIN", "SAC"],
    rows: docs.map((d) => [d.number, d.series, d.financialYear, d.kind, iso(d.issuedAt), iso(d.cancelledAt), d.currency, csvAmount(d.taxableMinor, d.currency), csvAmount(d.cgstMinor, d.currency), csvAmount(d.sgstMinor, d.currency), csvAmount(d.igstMinor, d.currency), csvAmount(d.otherTaxMinor, d.currency), csvAmount(d.totalMinor, d.currency), d.rateBps / 100, d.placeOfSupply ?? "", d.recipientGstin ?? "", d.sac]),
  };
}

/** B7: GSTR-1 tables 4A, 5, 7, 9B, 12 and 13 for one month, one table per block of rows. */
export async function gstr1Export(ctx: ReportContext, search: URLSearchParams): Promise<Built> {
  const months = periodBuckets(ctx.period, ctx.org.timezone, "month");
  const month = months.find((bucket) => bucket.key === search.get("month")) ?? months.at(-1);
  const window = month ? { from: month.from, to: month.to } : ctx.period;
  const [docs, refunds] = await Promise.all([loadTaxDocuments(ctx.scope), loadRefunds(ctx.scope)]);
  const r1 = gstr1(docs, refunds, window, ctx.org.stateCode);
  const money = (minor: number) => csvAmount(minor, "INR");
  const rows: unknown[][] = [
    ...r1.b2b.map((r) => ["4A B2B", r.gstin, r.number, iso(r.issuedAt), r.placeOfSupply ?? "", r.rateBps / 100, money(r.value), money(r.taxable), money(r.igst), money(r.cgst), money(r.sgst)]),
    ...r1.b2cl.map((r) => ["5 B2CL", "", r.number, iso(r.issuedAt), r.placeOfSupply ?? "", r.rateBps / 100, money(r.value), money(r.taxable), money(r.igst), "", ""]),
    ...r1.b2cs.map((r) => ["7 B2CS", r.supplyType, "", "", r.placeOfSupply, r.rateBps / 100, "", money(r.taxable), money(r.igst), money(r.cgst), money(r.sgst)]),
    ...[...r1.cdnr, ...r1.cdnur].map((r) => ["9B Credit note", r.gstin ?? "Unregistered", r.number, iso(r.issuedAt), r.placeOfSupply ?? "", r.rateBps / 100, money(r.value), money(r.taxable), money(r.igst), money(r.cgst), money(r.sgst)]),
    ...r1.hsnB2b.map((r) => ["12 SAC B2B", r.sac, r.uqc, r.quantity, "", r.rateBps / 100, "", money(r.taxable), money(r.igst), money(r.cgst), money(r.sgst)]),
    ...r1.hsnB2c.map((r) => ["12 SAC B2C", r.sac, r.uqc, r.quantity, "", r.rateBps / 100, "", money(r.taxable), money(r.igst), money(r.cgst), money(r.sgst)]),
    ...table13(docs, window).map((r) => ["13 Documents", r.nature, r.from, r.to, r.total, r.cancelled, r.netIssued, "", "", "", ""]),
  ];
  return { header: ["Table", "GSTIN / type / SAC / nature", "Number / UQC / from", "Date / quantity / to", "Place of supply / total", "Rate % / cancelled", "Value / net issued", "Taxable", "IGST", "CGST", "SGST"], rows, filters: { month: month?.key ?? "" } };
}
