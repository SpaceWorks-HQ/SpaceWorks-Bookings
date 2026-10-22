import type { Split, Statement } from "@/lib/accounts/statement";
import { money } from "@/lib/membership/describe";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/cn";

/** One currency's receipts and payments account: opening balance, receipts, payments, closing balance. */
export function StatementView({ statement, yearLabel, locale }: { statement: Statement; yearLabel: string; locale: string | null }) {
  const amount = (minor: number) => money(minor, statement.currency, locale);
  const row = (label: string, split: Split, options: { strong?: boolean; indent?: boolean; negative?: boolean } = {}) => (
    <TR key={label} className={cn(options.strong && "bg-subtle font-semibold")}>
      <TD className={cn(options.indent && "pl-8")}>{label}</TD>
      <TD className="text-right tabular-nums">{amount(options.negative ? -split.cash : split.cash)}</TD>
      <TD className="text-right tabular-nums">{amount(options.negative ? -split.bank : split.bank)}</TD>
      <TD className="text-right tabular-nums">{amount((options.negative ? -1 : 1) * (split.cash + split.bank))}</TD>
    </TR>
  );
  return (
    <Table label={`Receipts and payments account, ${statement.currency}, FY ${yearLabel}`}>
      <THead>
        <tr>
          <TH>{statement.currency}</TH>
          <TH className="text-right">Cash</TH>
          <TH className="text-right">Bank</TH>
          <TH className="text-right">Total</TH>
        </tr>
      </THead>
      <TBody>
        {row("Opening balance", statement.opening, { strong: true })}
        <TR><TD colSpan={4} className="pt-4 text-caption font-semibold uppercase tracking-wide text-ink-muted">Receipts</TD></TR>
        {statement.receipts.length ? statement.receipts.map((line) => row(line.label, line, { indent: true })) : <TR><TD colSpan={4} className="pl-8 text-ink-muted">Nothing received this year.</TD></TR>}
        {row("Total receipts", statement.totalReceipts, { strong: true })}
        <TR><TD colSpan={4} className="pt-4 text-caption font-semibold uppercase tracking-wide text-ink-muted">Payments</TD></TR>
        {statement.payments.length ? statement.payments.map((line) => row(line.label, line, { indent: true })) : <TR><TD colSpan={4} className="pl-8 text-ink-muted">Nothing paid out this year.</TD></TR>}
        {row("Total payments", statement.totalPayments, { strong: true })}
        {row("Closing balance", statement.closing, { strong: true })}
      </TBody>
    </Table>
  );
}
