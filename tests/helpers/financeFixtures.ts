import type { FinancePayment, FinancePaymentLine, FinanceRefund, FinanceTaxDocument } from "@/lib/reports/finance/types";

export const at = (iso: string) => new Date(`${iso}T12:00:00+05:30`);

export function payment(id: string, extra: Partial<FinancePayment> = {}): FinancePayment {
  return { id, customerEmail: "person@example.test", bookingId: null, status: "PAID", provider: "RAZORPAY", method: "upi", currency: "INR", amountMinor: 100_000, createdAt: at("2026-05-01"), paidAt: at("2026-05-01"), flagged: false, recordedById: null, confirmedById: null, ...extra };
}

export function line(paymentId: string, kind: FinancePaymentLine["kind"], amountMinor: number, currency = "INR"): FinancePaymentLine {
  return { paymentId, kind, currency, amountMinor, taxableMinor: amountMinor, cgstMinor: 0, sgstMinor: 0, igstMinor: 0, otherTaxMinor: 0 };
}

export function refund(id: string, paymentId: string, amountMinor: number, extra: Partial<FinanceRefund> = {}): FinanceRefund {
  return { id, paymentId, currency: "INR", amountMinor, status: "PROCESSED", createdAt: at("2026-06-01"), processedAt: at("2026-06-02"), ...extra };
}

/** An 18% intra-state INR invoice by default: taxable 1000, CGST 90, SGST 90. */
export function doc(id: string, sequence: number, extra: Partial<FinanceTaxDocument> = {}): FinanceTaxDocument {
  return {
    id, paymentId: `pay-${id}`, refundId: null, kind: "TAX_INVOICE", number: `INV/2026-27/${String(sequence).padStart(4, "0")}`, series: "INV", sequence, financialYear: "2026-27",
    issuedAt: at("2026-05-10"), cancelledAt: null, currency: "INR", totalMinor: 118_000, taxableMinor: 100_000, cgstMinor: 9_000, sgstMinor: 9_000, igstMinor: 0, otherTaxMinor: 0,
    rateBps: 1800, placeOfSupply: "KL", recipientGstin: null, sac: "997212", ...extra,
  };
}
