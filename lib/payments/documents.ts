import "server-only";

import type { Makerspace, Prisma, TaxDocument } from "@prisma/client";
import { financialYearLabel, localDate } from "@/lib/calendarDate";
import { formatDocumentNumber, type DocumentSeries } from "./numbering";
import { creditNoteLines, placeOfSupply, sumSplits, type TaxSnapshot } from "./tax";

type Tx = Prisma.TransactionClient;
type MakerspaceForDocs = Pick<Makerspace, "id" | "name" | "timezone" | "financialYearStartMonth" | "addressLine" | "city" | "stateCode" | "postalCode" | "contactEmail" | "locale" | "logoUrl">;

export const DOCUMENT_TEMPLATE_VERSION = 1;

/** Everything a document PDF needs, frozen at issue so a re-render years later looks identical. */
export type DocumentSnapshot = {
  kind: TaxDocument["kind"];
  number: string;
  issuedAt: string;
  financialYear: string;
  currency: string;
  locale: string | null;
  timeZone: string;
  issuer: { name: string; legalName: string | null; gstin: string | null; address: string; state: string | null; email: string | null; logoUrl: string | null };
  recipient: { name: string; email: string | null; state: string | null; gstin: string | null };
  placeOfSupply: string | null;
  sac: string | null;
  tax: Pick<TaxSnapshot, "mode" | "rateBps" | "inclusive" | "taxName" | "zeroRatedExport" | "lutNumber">;
  lines: Array<{ description: string; amountMinor: number; taxableMinor: number; cgstMinor: number; sgstMinor: number; igstMinor: number; otherTaxMinor: number }>;
  totals: { amountMinor: number; taxableMinor: number; cgstMinor: number; sgstMinor: number; igstMinor: number; otherTaxMinor: number };
  payment: { provider: string; method: string | null; reference: string | null; paidAt: string | null };
  original: { number: string; issuedAt: string } | null;
};

/** Next number in a gapless series. Callers hold the payment row lock first (lock order: payment, counter). */
async function allocate(tx: Tx, makerspaceId: string, series: DocumentSeries, financialYear: string) {
  const [row] = await tx.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "DocumentCounter" ("makerspaceId", "series", "financialYear", "next") VALUES (${makerspaceId}, ${series}, ${financialYear}, 2)
    ON CONFLICT ("makerspaceId", "series", "financialYear") DO UPDATE SET "next" = "DocumentCounter"."next" + 1
    RETURNING "next" - 1 AS value`;
  return Number(row.value);
}

function issuerOf(makerspace: MakerspaceForDocs, snapshot: TaxSnapshot): DocumentSnapshot["issuer"] {
  const address = snapshot.address || [makerspace.addressLine, makerspace.city, makerspace.postalCode].filter(Boolean).join(", ");
  return { name: makerspace.name, legalName: snapshot.legalName, gstin: snapshot.gstin, address, state: snapshot.supplierState ?? makerspace.stateCode, email: makerspace.contactEmail, logoUrl: makerspace.logoUrl };
}

const paymentForDocument = { lines: true } satisfies Prisma.PaymentInclude;

function recipientOf(payment: { customerName: string; customerEmail: string; customerStateCode: string | null; customerGstin: string | null }): DocumentSnapshot["recipient"] {
  return { name: payment.customerName, email: payment.customerEmail, state: payment.customerStateCode, gstin: payment.customerGstin };
}

/**
 * Issue the receipt, tax invoice or bill of supply for a settled payment. Idempotent per payment.
 * `receivedMinor` re-apportions the lines when a manager accepts a mismatched capture.
 */
export async function issuePaymentDocument(tx: Tx, makerspace: MakerspaceForDocs, paymentId: string, prefix: string, now = new Date(), receivedMinor?: number) {
  const existing = await tx.taxDocument.findFirst({ where: { makerspaceId: makerspace.id, paymentId, kind: { not: "CREDIT_NOTE" } } });
  if (existing) return existing;
  const payment = await tx.payment.findUniqueOrThrow({ where: { makerspaceId_id: { makerspaceId: makerspace.id, id: paymentId } }, include: paymentForDocument });
  const tax = payment.taxSnapshot as unknown as TaxSnapshot;
  const financialYear = financialYearLabel(localDate(now, makerspace.timezone), makerspace.financialYearStartMonth);
  const sequence = await allocate(tx, makerspace.id, "R", financialYear);
  const number = formatDocumentNumber(prefix, "R", financialYear, sequence);
  const lines = receivedMinor === undefined ? payment.lines : creditNoteLines(payment.lines, receivedMinor);
  const totals = sumSplits(lines);
  const pos = placeOfSupply(payment.customerStateCode, tax);
  const snapshot: DocumentSnapshot = {
    kind: tax.documentKind,
    number,
    issuedAt: now.toISOString(),
    financialYear,
    currency: payment.currency,
    locale: makerspace.locale,
    timeZone: makerspace.timezone,
    issuer: issuerOf(makerspace, tax),
    recipient: recipientOf(payment),
    placeOfSupply: tax.mode === "GST" ? pos : null,
    sac: tax.sac,
    tax: { mode: tax.mode, rateBps: tax.rateBps, inclusive: tax.inclusive, taxName: tax.taxName, zeroRatedExport: tax.zeroRatedExport, lutNumber: tax.lutNumber },
    lines: lines.map(({ description, amountMinor, taxableMinor, cgstMinor, sgstMinor, igstMinor, otherTaxMinor }) => ({ description, amountMinor, taxableMinor, cgstMinor, sgstMinor, igstMinor, otherTaxMinor })),
    totals,
    payment: { provider: payment.provider, method: payment.method, reference: payment.gatewayPaymentId ?? payment.utr ?? payment.reference, paidAt: payment.paidAt?.toISOString() ?? null },
    original: null,
  };
  return tx.taxDocument.create({
    data: {
      makerspaceId: makerspace.id,
      paymentId,
      kind: tax.documentKind,
      series: "R",
      financialYear,
      sequence,
      number,
      currency: payment.currency,
      totalMinor: totals.amountMinor,
      taxableMinor: totals.taxableMinor,
      cgstMinor: totals.cgstMinor,
      sgstMinor: totals.sgstMinor,
      igstMinor: totals.igstMinor,
      otherTaxMinor: totals.otherTaxMinor,
      placeOfSupply: snapshot.placeOfSupply,
      sac: tax.sac,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      templateVersion: DOCUMENT_TEMPLATE_VERSION,
      issuedAt: now,
    },
  });
}

/** A credit note for a processed refund, apportioning tax pro rata across the original lines. */
export async function issueCreditNote(tx: Tx, makerspace: MakerspaceForDocs, refundId: string, prefix: string, now = new Date()) {
  const existing = await tx.taxDocument.findUnique({ where: { refundId } });
  if (existing) return existing;
  const refund = await tx.refund.findUniqueOrThrow({ where: { makerspaceId_id: { makerspaceId: makerspace.id, id: refundId } } });
  const payment = await tx.payment.findUniqueOrThrow({ where: { makerspaceId_id: { makerspaceId: makerspace.id, id: refund.paymentId } }, include: { ...paymentForDocument, documents: { where: { kind: { not: "CREDIT_NOTE" } } } } });
  const original = payment.documents[0];
  const tax = payment.taxSnapshot as unknown as TaxSnapshot;
  const earlier = await tx.refund.aggregate({ where: { paymentId: payment.id, status: "PROCESSED", id: { not: refund.id } }, _sum: { amountMinor: true } });
  const lines = creditNoteLines(payment.lines, refund.amountMinor, earlier._sum.amountMinor ?? 0);
  const totals = sumSplits(lines);
  const financialYear = financialYearLabel(localDate(now, makerspace.timezone), makerspace.financialYearStartMonth);
  const sequence = await allocate(tx, makerspace.id, "C", financialYear);
  const number = formatDocumentNumber(prefix, "C", financialYear, sequence);
  const originalSnapshot = original?.snapshot as unknown as DocumentSnapshot | undefined;
  const snapshot: DocumentSnapshot = {
    kind: "CREDIT_NOTE",
    number,
    issuedAt: now.toISOString(),
    financialYear,
    currency: refund.currency,
    locale: makerspace.locale,
    timeZone: makerspace.timezone,
    issuer: originalSnapshot?.issuer ?? issuerOf(makerspace, tax),
    recipient: originalSnapshot?.recipient ?? recipientOf(payment),
    placeOfSupply: original?.placeOfSupply ?? null,
    sac: tax.sac,
    tax: { mode: tax.mode, rateBps: tax.rateBps, inclusive: tax.inclusive, taxName: tax.taxName, zeroRatedExport: tax.zeroRatedExport, lutNumber: tax.lutNumber },
    lines: lines.map(({ description, amountMinor, taxableMinor, cgstMinor, sgstMinor, igstMinor, otherTaxMinor }) => ({ description, amountMinor, taxableMinor, cgstMinor, sgstMinor, igstMinor, otherTaxMinor })),
    totals,
    payment: { provider: payment.provider, method: payment.method, reference: refund.gatewayRefundId ?? null, paidAt: refund.processedAt?.toISOString() ?? null },
    original: original ? { number: original.number, issuedAt: original.issuedAt.toISOString() } : null,
  };
  return tx.taxDocument.create({
    data: {
      makerspaceId: makerspace.id,
      paymentId: payment.id,
      refundId,
      kind: "CREDIT_NOTE",
      series: "C",
      financialYear,
      sequence,
      number,
      currency: refund.currency,
      totalMinor: totals.amountMinor,
      taxableMinor: totals.taxableMinor,
      cgstMinor: totals.cgstMinor,
      sgstMinor: totals.sgstMinor,
      igstMinor: totals.igstMinor,
      otherTaxMinor: totals.otherTaxMinor,
      placeOfSupply: snapshot.placeOfSupply,
      sac: tax.sac,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      templateVersion: DOCUMENT_TEMPLATE_VERSION,
      issuedAt: now,
    },
  });
}
