import type { SubscriptionIncome } from "@/lib/reports/finance/subscriptionIncome";
import { formatAmount } from "@/lib/reports/money";
import { DataTable } from "./charts/ChartFrame";

/**
 * Subscription income for the financial year, laid out the way a society's income and expenditure account
 * needs it: what was received, the advances and arrears either side of the year, and what was earned.
 */
export function SubscriptionIncomeSection({ rows, yearLabel, locale }: { rows: SubscriptionIncome[]; yearLabel: string; locale: string | null }) {
  if (rows.length === 0) return null;
  const money = (minor: number, currency: string) => formatAmount(minor, currency, locale);
  const lines: Array<[string, (row: SubscriptionIncome) => number]> = [
    ["Membership fees received in the year", (row) => row.received],
    ["Add: received in advance at the start", (row) => row.advanceOpening],
    ["Less: received in advance at the end", (row) => -row.advanceClosing],
    ["Add: earned but received after the year end", (row) => row.arrearsClosing],
    ["Less: earlier years' fees received this year", (row) => -row.arrearsOpening],
    ["Membership fees earned in the year", (row) => row.earned],
    ["Joining fees and lifetime memberships (income when received)", (row) => row.receivedOnReceipt],
  ];
  return (
    <section aria-labelledby="subscription-title" className="flex flex-col gap-3">
      <div>
        <h2 id="subscription-title" className="text-h4 text-ink">Subscription income, {yearLabel}</h2>
        <p className="text-label text-ink-muted">Fees are earned over the days a membership covers. Taxable values only, net of refunds. Check the figures with your accountant before filing.</p>
      </div>
      <DataTable
        table={{
          caption: `Subscription income for ${yearLabel}`,
          columns: ["", ...rows.map((row) => row.currency)],
          rows: lines.map(([label, pick]) => [label, ...rows.map((row) => money(pick(row), row.currency))]),
        }}
      />
    </section>
  );
}
