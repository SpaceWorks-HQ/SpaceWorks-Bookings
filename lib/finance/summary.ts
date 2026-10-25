import type { FinanceCategory, FinanceDirection, FinanceMethod } from "@prisma/client";

/**
 * Finance maths (pure). Every category has a natural side: money in (payments, other income) or money out (refunds,
 * repair payouts, rent…). An entry on the other side, a reversal, counts against its category, so reversing an
 * expense lowers expenses rather than adding income. Amounts are per currency and never added across currencies.
 */

export const INCOME_CATEGORIES: readonly FinanceCategory[] = ["BOOKING_PAYMENT", "OTHER_PAYMENT", "OTHER_INCOME"];
export const CATEGORY_LABELS: Record<FinanceCategory, string> = {
  BOOKING_PAYMENT: "Booking payments", OTHER_PAYMENT: "Other payments", REFUND: "Refunds", REPAIR_PAYOUT: "Repairs",
  RENT: "Rent", UTILITIES: "Utilities", SUPPLIES: "Supplies", STAFF_COSTS: "Staff costs", OTHER_INCOME: "Other income", OTHER_EXPENSE: "Other expenses",
};
export const METHOD_LABELS: Record<FinanceMethod, string> = {
  GATEWAY_RAZORPAY: "Razorpay", GATEWAY_STRIPE: "Stripe", CASH: "Cash", BANK_TRANSFER: "Bank transfer", UPI: "UPI", OTHER: "Other",
};

export type LedgerRow = {
  direction: FinanceDirection; category: FinanceCategory; amountMinor: number; currency: string; method: FinanceMethod;
  occurredAt: Date; spaceId: string | null;
};

export const isIncome = (category: FinanceCategory) => INCOME_CATEGORIES.includes(category);

/** The row's amount on its category's natural side: positive normally, negative for a reversal. */
export function signedAmount(row: Pick<LedgerRow, "direction" | "category" | "amountMinor">): number {
  const natural: FinanceDirection = isIncome(row.category) ? "IN" : "OUT";
  return row.direction === natural ? row.amountMinor : -row.amountMinor;
}

export type FinanceTotals = { income: number; expenses: number; net: number };

export function financeTotals(rows: LedgerRow[], currency: string): FinanceTotals {
  let income = 0;
  let expenses = 0;
  for (const row of rows) {
    if (row.currency !== currency) continue;
    if (isIncome(row.category)) income += signedAmount(row);
    else expenses += signedAmount(row);
  }
  return { income, expenses, net: income - expenses };
}

/** Totals grouped by a key (category, method, space…), largest first; empty groups are left out. */
export function groupBy(rows: LedgerRow[], currency: string, key: (row: LedgerRow) => string): Array<{ key: string; income: number; expenses: number; count: number }> {
  const groups = new Map<string, { key: string; income: number; expenses: number; count: number }>();
  for (const row of rows) {
    if (row.currency !== currency) continue;
    const name = key(row);
    const group = groups.get(name) ?? { key: name, income: 0, expenses: 0, count: 0 };
    if (isIncome(row.category)) group.income += signedAmount(row);
    else group.expenses += signedAmount(row);
    group.count += 1;
    groups.set(name, group);
  }
  return [...groups.values()].filter((group) => group.income !== 0 || group.expenses !== 0).sort((a, b) => b.income + b.expenses - (a.income + a.expenses));
}

/** Income and expenses per bucket (half-open [from, to) ranges in ms). */
export function series(rows: LedgerRow[], currency: string, buckets: Array<{ from: number; to: number }>) {
  const income = buckets.map(() => 0);
  const expenses = buckets.map(() => 0);
  for (const row of rows) {
    if (row.currency !== currency) continue;
    const at = row.occurredAt.getTime();
    const index = buckets.findIndex((bucket) => at >= bucket.from && at < bucket.to);
    if (index < 0) continue;
    if (isIncome(row.category)) income[index] += signedAmount(row);
    else expenses[index] += signedAmount(row);
  }
  return { income, expenses };
}

/** Per space: what its bookings brought in against what its repairs cost. */
export function spaceRepairCosts(rows: LedgerRow[], currency: string) {
  const bySpace = new Map<string, { revenue: number; repairs: number }>();
  for (const row of rows) {
    if (row.currency !== currency || !row.spaceId) continue;
    const entry = bySpace.get(row.spaceId) ?? { revenue: 0, repairs: 0 };
    if (row.category === "BOOKING_PAYMENT" || row.category === "REFUND") entry.revenue += row.category === "REFUND" ? -signedAmount(row) : signedAmount(row);
    else if (row.category === "REPAIR_PAYOUT") entry.repairs += signedAmount(row);
    bySpace.set(row.spaceId, entry);
  }
  return bySpace;
}
