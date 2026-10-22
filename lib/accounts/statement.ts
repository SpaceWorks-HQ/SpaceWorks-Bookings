import { isCash } from "./categories";

/**
 * The receipts and payments account for one financial year, the cash-basis summary societies and clubs file
 * with their accounts: opening cash and bank, everything received, everything paid out, closing cash and
 * bank. Pure over rows; one statement per currency, never mixed. Membership money comes from the payment
 * tables (fees, joining fees and the tax collected on them; refunds paid back), everything else from the
 * organisation's own ledger entries. docs/REPORTS.md describes the layout.
 */

export type Split = { cash: number; bank: number };
export type StatementLine = Split & { label: string };
export type Statement = {
  currency: string;
  opening: Split;
  receipts: StatementLine[];
  payments: StatementLine[];
  totalReceipts: Split;
  totalPayments: Split;
  closing: Split;
};

export type StatementInput = {
  openings: Array<{ currency: string; cashMinor: number; bankMinor: number }>;
  /** Payments settled (PAID) during the year, with how they were paid. */
  payments: Array<{ id: string; currency: string; method: string | null; provider: string }>;
  lines: Array<{ paymentId: string; kind: string; taxableMinor: number; cgstMinor: number; sgstMinor: number; igstMinor: number; otherTaxMinor: number }>;
  /** Refunds processed during the year, with the payment they reverse. */
  refunds: Array<{ paymentId: string; currency: string; amountMinor: number }>;
  refundPayments: Array<{ id: string; method: string | null; provider: string }>;
  /** Ledger entries dated in the year, voided ones excluded. */
  entries: Array<{ direction: "RECEIPT" | "PAYMENT"; category: string; currency: string; amountMinor: number; method: string }>;
  taxName: string;
};

const zero = (): Split => ({ cash: 0, bank: 0 });
const total = (split: Split) => split.cash + split.bank;
const settledInCash = (payment: { method: string | null; provider: string }) => payment.provider === "OFFLINE" && isCash(payment.method);

function add(map: Map<string, Split>, label: string, amount: number, cash: boolean) {
  const split = map.get(label) ?? zero();
  if (cash) split.cash += amount;
  else split.bank += amount;
  map.set(label, split);
}

const lines = (map: Map<string, Split>, order: string[]) =>
  [...map.entries()]
    .filter(([, split]) => total(split) !== 0)
    .sort(([a], [b]) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)) || a.localeCompare(b))
    .map(([label, split]) => ({ label, ...split }));

const sum = (rows: Split[]) => rows.reduce((acc, row) => ({ cash: acc.cash + row.cash, bank: acc.bank + row.bank }), zero());

export function receiptsAndPayments(input: StatementInput, primary?: string): Statement[] {
  const currencies = new Set<string>([...input.openings.map((row) => row.currency), ...input.payments.map((row) => row.currency), ...input.refunds.map((row) => row.currency), ...input.entries.map((row) => row.currency)]);
  const paymentById = new Map(input.payments.map((payment) => [payment.id, payment]));
  const refundPaymentById = new Map(input.refundPayments.map((payment) => [payment.id, payment]));
  const statements: Statement[] = [];

  for (const currency of currencies) {
    const opening = input.openings.find((row) => row.currency === currency);
    const receipts = new Map<string, Split>();
    const payments = new Map<string, Split>();
    for (const line of input.lines) {
      const payment = paymentById.get(line.paymentId);
      if (!payment || payment.currency !== currency) continue;
      const cash = settledInCash(payment);
      add(receipts, line.kind === "TERM_FEE" ? "Membership fees" : "Joining fees", line.taxableMinor, cash);
      const tax = line.cgstMinor + line.sgstMinor + line.igstMinor + line.otherTaxMinor;
      if (tax) add(receipts, `${input.taxName} collected`, tax, cash);
    }
    for (const refund of input.refunds) {
      if (refund.currency !== currency) continue;
      const payment = refundPaymentById.get(refund.paymentId);
      add(payments, "Refunds to members", refund.amountMinor, payment ? settledInCash(payment) : false);
    }
    for (const entry of input.entries) {
      if (entry.currency !== currency) continue;
      add(entry.direction === "RECEIPT" ? receipts : payments, entry.category, entry.amountMinor, isCash(entry.method));
    }
    const receiptLines = lines(receipts, ["Membership fees", "Joining fees", `${input.taxName} collected`]);
    const paymentLines = lines(payments, ["Refunds to members"]);
    const totalReceipts = sum(receiptLines);
    const totalPayments = sum(paymentLines);
    const open = { cash: opening?.cashMinor ?? 0, bank: opening?.bankMinor ?? 0 };
    statements.push({
      currency,
      opening: open,
      receipts: receiptLines,
      payments: paymentLines,
      totalReceipts,
      totalPayments,
      closing: { cash: open.cash + totalReceipts.cash - totalPayments.cash, bank: open.bank + totalReceipts.bank - totalPayments.bank },
    });
  }
  return statements.sort((a, b) => (a.currency === primary ? -1 : b.currency === primary ? 1 : a.currency.localeCompare(b.currency)));
}
