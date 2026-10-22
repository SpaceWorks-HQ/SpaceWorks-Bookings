import { describe, expect, it } from "vitest";
import { receiptsAndPayments, type StatementInput } from "@/lib/accounts/statement";

const base: StatementInput = {
  openings: [{ currency: "INR", cashMinor: 50_000, bankMinor: 1_000_000 }],
  payments: [
    { id: "p-upi", currency: "INR", method: "upi", provider: "RAZORPAY" },
    { id: "p-cash", currency: "INR", method: "cash", provider: "OFFLINE" },
  ],
  lines: [
    { paymentId: "p-upi", kind: "TERM_FEE", taxableMinor: 100_000, cgstMinor: 9_000, sgstMinor: 9_000, igstMinor: 0, otherTaxMinor: 0 },
    { paymentId: "p-upi", kind: "JOINING_FEE", taxableMinor: 50_000, cgstMinor: 4_500, sgstMinor: 4_500, igstMinor: 0, otherTaxMinor: 0 },
    { paymentId: "p-cash", kind: "TERM_FEE", taxableMinor: 100_000, cgstMinor: 9_000, sgstMinor: 9_000, igstMinor: 0, otherTaxMinor: 0 },
  ],
  refunds: [{ paymentId: "p-cash", currency: "INR", amountMinor: 59_000 }],
  refundPayments: [{ id: "p-cash", method: "cash", provider: "OFFLINE" }],
  entries: [
    { direction: "RECEIPT", category: "Donations", currency: "INR", amountMinor: 200_000, method: "bank_transfer" },
    { direction: "PAYMENT", category: "Rent", currency: "INR", amountMinor: 300_000, method: "bank_transfer" },
    { direction: "PAYMENT", category: "Consumables", currency: "INR", amountMinor: 20_000, method: "cash" },
    { direction: "RECEIPT", category: "Grants", currency: "USD", amountMinor: 50_000, method: "bank_transfer" },
  ],
  taxName: "GST",
};

describe("receipts and payments account", () => {
  const [inr, usd] = receiptsAndPayments(base, "INR");

  it("lists membership money first, then the organisation's own entries, split between cash and bank", () => {
    expect(inr.receipts).toEqual([
      { label: "Membership fees", cash: 100_000, bank: 100_000 },
      { label: "Joining fees", cash: 0, bank: 50_000 },
      { label: "GST collected", cash: 18_000, bank: 27_000 },
      { label: "Donations", cash: 0, bank: 200_000 },
    ]);
    expect(inr.payments).toEqual([
      { label: "Refunds to members", cash: 59_000, bank: 0 },
      { label: "Consumables", cash: 20_000, bank: 0 },
      { label: "Rent", cash: 0, bank: 300_000 },
    ]);
  });

  it("carries the opening balance through to a closing balance that adds up", () => {
    expect(inr.closing.cash).toBe(50_000 + 118_000 - 79_000);
    expect(inr.closing.bank).toBe(1_000_000 + 377_000 - 300_000);
    const totals = (s: typeof inr) => s.opening.cash + s.opening.bank + s.totalReceipts.cash + s.totalReceipts.bank - s.totalPayments.cash - s.totalPayments.bank;
    expect(totals(inr)).toBe(inr.closing.cash + inr.closing.bank);
  });

  it("keeps each currency on its own statement", () => {
    expect(usd.currency).toBe("USD");
    expect(usd.receipts).toEqual([{ label: "Grants", cash: 0, bank: 50_000 }]);
    expect(usd.opening).toEqual({ cash: 0, bank: 0 });
  });
});
