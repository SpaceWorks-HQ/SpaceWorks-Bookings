/**
 * Money helpers for reports. Client-safe. Reports never add different currencies together: every money
 * figure is a list of per-currency totals with the makerspace's default currency first (owner rule,
 * design "Multiple currencies"). Built on lib/money/currencies.ts totalsByCurrency.
 */
import { formatMoney, isCurrencyCode, toInputValue, totalsByCurrency } from "@/lib/money/currencies";

export type CurrencyTotal = { currency: string; minor: number };

export function totals<T>(rows: T[], amount: (row: T) => { currency: string; minor: number }, primary?: string): CurrencyTotal[] {
  return totalsByCurrency(rows.map(amount), primary);
}

/** The amount for one currency in a totals list (0 when absent). */
export function amountIn(list: CurrencyTotal[], currency: string): number {
  return list.find((entry) => entry.currency === currency)?.minor ?? 0;
}

/** a − b, per currency. */
export function subtractTotals(a: CurrencyTotal[], b: CurrencyTotal[], primary?: string): CurrencyTotal[] {
  return totalsByCurrency([...a, ...b.map((entry) => ({ currency: entry.currency, minor: -entry.minor }))], primary);
}

/** Every currency present in some rows, the makerspace's default first. */
export function currenciesOf(rows: Array<{ currency: string }>, primary?: string): string[] {
  return totalsByCurrency(rows.map((row) => ({ currency: row.currency, minor: 0 })), primary).map((entry) => entry.currency);
}

/** Group rows by a key and total each group per currency. Groups are sorted by their primary-currency total. */
export function groupTotals<T>(rows: T[], key: (row: T) => string, amount: (row: T) => CurrencyTotal, primary?: string): Array<{ key: string; totals: CurrencyTotal[]; count: number }> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    groups.set(k, [...(groups.get(k) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([k, list]) => ({ key: k, totals: totalsByCurrency(list.map(amount), primary), count: list.length }))
    .sort((a, b) => (primary ? amountIn(b.totals, primary) - amountIn(a.totals, primary) : 0) || b.count - a.count || a.key.localeCompare(b.key));
}

/** "₹1,200.00 · $50.00", or "—" when empty. Unknown codes fall back to "XYZ 123". */
export function formatTotals(list: CurrencyTotal[], locale?: string | null): string {
  if (!list.length) return "—";
  return list.map((entry) => formatAmount(entry.minor, entry.currency, locale)).join(" · ");
}

export function formatAmount(minor: number, currency: string, locale?: string | null): string {
  return isCurrencyCode(currency) ? formatMoney(minor, currency, locale ?? undefined) : `${currency} ${minor}`;
}

/** Minor units to a plain decimal string for CSV ("1200.50"), honouring the currency's exponent. */
export function csvAmount(minor: number, currency: string): string {
  return isCurrencyCode(currency) ? toInputValue(minor, currency) : String(minor);
}
