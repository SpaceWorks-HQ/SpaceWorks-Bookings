/**
 * The finance data contract: the plain rows every finance report is computed from. Client-safe types
 * only. lib/reports/finance/source.ts loads them (P7 wires it to the payment tables); every function in
 * lib/reports/finance/* is pure over these arrays, so it is unit-tested without a database.
 *
 * Money is integer minor units with an ISO 4217 code beside it. Nothing here ever adds two currencies.
 */

export type PaymentStatus = "PENDING" | "AWAITING_CONFIRMATION" | "PAID" | "WAIVED" | "FAILED" | "CANCELLED";
export type PaymentProvider = "RAZORPAY" | "STRIPE" | "OFFLINE";
export type FeeKind = "TERM_FEE" | "JOINING_FEE" | "REJOIN_FEE";
export type RefundStatus = "PENDING" | "PROCESSED" | "FAILED";
export type TaxDocumentKind = "RECEIPT" | "TAX_INVOICE" | "BILL_OF_SUPPLY" | "CREDIT_NOTE";

export type FinancePayment = {
  id: string;
  memberId: string;
  termId: string | null;
  /** The member's unit (through the member), for unit filters and the unit breakdown. */
  unitId: string | null;
  /** The term's plan (through the term). */
  planId: string | null;
  status: PaymentStatus;
  provider: PaymentProvider;
  /** "upi", "card", "netbanking", "cash", "bank_transfer", "cheque"… */
  method: string | null;
  currency: string;
  amountMinor: number;
  createdAt: Date;
  paidAt: Date | null;
  /** Needs a person to look at it (amount mismatch, late capture with no revive, suspended organisation…). */
  flagged: boolean;
  recordedById: string | null;
  confirmedById: string | null;
};

export type FinancePaymentLine = {
  paymentId: string;
  kind: FeeKind;
  currency: string;
  amountMinor: number;
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  /** SIMPLE-mode tax (VAT and the like). */
  otherTaxMinor: number;
};

export type FinanceRefund = {
  id: string;
  paymentId: string;
  currency: string;
  amountMinor: number;
  status: RefundStatus;
  createdAt: Date;
  processedAt: Date | null;
};

export type FinanceTaxDocument = {
  id: string;
  paymentId: string | null;
  refundId: string | null;
  kind: TaxDocumentKind;
  number: string;
  /** The counter series the number came from, e.g. "INV" or "CN" (DocumentCounter.series). */
  series: string;
  /** The counter value inside (series, financialYear): 1, 2, 3… Used for the gap check. */
  sequence: number;
  /** "2026-27". */
  financialYear: string;
  issuedAt: Date;
  cancelledAt: Date | null;
  currency: string;
  totalMinor: number;
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  otherTaxMinor: number;
  /** Total tax rate in basis points (1800 = 18%), from the frozen tax snapshot. */
  rateBps: number;
  /** Two-letter state code of the place of supply; null outside GST. */
  placeOfSupply: string | null;
  /** The member's GSTIN when they gave one (B2B), else null (B2C). */
  recipientGstin: string | null;
  sac: string;
};

/** A PENDING_PAYMENT term with no Payment row yet: money owed that no checkout has started. */
export type UnpaidTerm = {
  termId: string;
  memberId: string;
  planId: string;
  unitId: string | null;
  currency: string;
  /** Price plus joining fee frozen on the term. */
  amountMinor: number;
  createdAt: Date;
  paymentDueBy: Date | null;
};

/** Plan prices for the renewal forecast. */
export type FinancePlan = { id: string; name: string; currency: string; priceRenewalMinor: number };

export type FinanceRows = {
  payments: FinancePayment[];
  lines: FinancePaymentLine[];
  refunds: FinanceRefund[];
  documents: FinanceTaxDocument[];
  unpaidTerms: UnpaidTerm[];
};

export const EMPTY_FINANCE_ROWS: FinanceRows = { payments: [], lines: [], refunds: [], documents: [], unpaidTerms: [] };
