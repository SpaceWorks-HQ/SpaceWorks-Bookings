/** Suggested ledger categories and payment methods. Client-safe; managers may also type their own category. */

export const RECEIPT_CATEGORIES = ["Donations", "Grants", "Sponsorship", "Event income", "Sale of goods", "Interest", "Other receipts"] as const;

export const PAYMENT_CATEGORIES = [
  "Rent",
  "Utilities",
  "Equipment and tools",
  "Consumables",
  "Events",
  "Printing and stationery",
  "Salaries and honoraria",
  "Professional fees",
  "Travel",
  "Bank charges",
  "GST paid",
  "Other payments",
] as const;

export const LEDGER_METHODS = ["cash", "bank_transfer", "upi", "cheque", "card", "other"] as const;
export type LedgerMethod = (typeof LEDGER_METHODS)[number];

export const LEDGER_METHOD_LABELS: Record<LedgerMethod, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  upi: "UPI",
  cheque: "Cheque",
  card: "Card",
  other: "Other",
};

/** Cash moves cash in hand; every other method moves the bank balance. */
export function isCash(method: string | null | undefined) {
  return method === "cash";
}
