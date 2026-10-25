import Link from "next/link";
import type { Metadata } from "next";
import { loadFinance } from "@/lib/views/app__dashboard__makerspaceSlug__finance__page";
import { MakerspacePageHeader } from "@/components/dashboard/makerspace/MakerspacePageHeader";
import { BarList } from "@/components/reports/charts/BarList";
import { ColumnChart } from "@/components/reports/charts/ColumnChart";
import { ChartFrame } from "@/components/reports/charts/ChartFrame";
import { KpiTile } from "@/components/reports/charts/Figures";
import { ManualEntryForm, ReverseEntryForm } from "@/components/finance/FinanceForms";
import { Pagination } from "@/components/bookings/Pagination";
import { Card, Chip, EmptyState } from "@/components/ui/display";
import { NavTabs } from "@/components/ui/tabs";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { buttonClasses } from "@/components/ui/button";
import { bookingDate } from "@/lib/bookings/publicUi";
import { formatDayTime } from "@/lib/format/datetime";
import { money } from "@/lib/money/currencies";

export const metadata: Metadata = { title: "Finance", robots: { index: false, follow: false } };

const PRESET_LABELS: Record<string, string> = { fy: "This year", "last-fy": "Last year", "12m": "12 months", "90d": "90 days", "30d": "30 days", month: "This month" };

export default async function FinancePage(props: Parameters<typeof loadFinance>[0]) {
  const view = await loadFinance(props);
  const slug = view.makerspace.slug;
  const base = `/dashboard/${slug}/finance`;
  const amount = (minor: number) => money(minor, view.currency);
  const exportUrl = (path: string, format: string) => `/api/exports/${path}/${slug}?${new URLSearchParams([...new URLSearchParams(view.exportQuery), ["format", format]]).toString()}`;
  return <div className="flex flex-col gap-6">
    <MakerspacePageHeader makerspace={view.makerspace} title="Finance" description={`${view.period.label}. Every payment, refund, repair payout and hand-posted entry, in ${view.currency}.`}
      actions={<div className="flex flex-wrap gap-3">
        <a className={buttonClasses({ variant: "secondary" })} href={exportUrl("finance", "xlsx")}>Export (Excel)</a>
        <a className={buttonClasses({ variant: "secondary" })} href={exportUrl("finance", "csv")}>Export (CSV)</a>
        <a className={buttonClasses({ variant: "secondary" })} href={exportUrl("repairs", "xlsx")}>Repair spend (Excel)</a>
      </div>} />
    <NavTabs label="Period" items={view.presets.map((preset) => ({ href: `${base}?period=${preset}`, label: PRESET_LABELS[preset] ?? preset, active: view.period.preset === preset }))} />
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <KpiTile label="Money in" value={view.totals.income} format={`money:${view.currency}`} />
      <KpiTile label="Money out" value={view.totals.expenses} format={`money:${view.currency}`} />
      <KpiTile label="Net" value={view.totals.net} format={`money:${view.currency}`} />
    </div>
    {view.otherCurrencies.length ? <p className="text-ink-secondary">Entries in {view.otherCurrencies.join(", ")} are in the exports but not in these totals.</p> : null}
    <ChartFrame collapse={{ id: "finance-in-out", empty: !view.totals.income && !view.totals.expenses }} title="In and out" description="Money in and money out in each part of the period.">
      <ColumnChart ariaLabel="Money in and out" format={`money:${view.currency}`} labels={view.buckets} series={[{ key: "in", label: "In", slot: 2, values: view.series.income }, { key: "out", label: "Out", slot: 4, values: view.series.expenses }]} />
    </ChartFrame>
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
      <ChartFrame collapse={{ id: "finance-category", empty: view.byCategory.length === 0 }} title="By category"><BarList label="By category" items={view.byCategory.map((row) => ({ key: row.key, label: row.label, value: Math.abs(row.income || row.expenses), display: `${amount(row.income || row.expenses)} · ${row.count}` }))} empty="Nothing in this period." /></ChartFrame>
      <ChartFrame collapse={{ id: "finance-method", empty: view.byMethod.length === 0 }} title="By way of paying"><BarList label="By way of paying" items={view.byMethod.map((row) => ({ key: row.key, label: row.label, value: Math.abs(row.income - row.expenses), display: `in ${amount(row.income)} · out ${amount(row.expenses)}` }))} empty="Nothing in this period." /></ChartFrame>
      <ChartFrame collapse={{ id: "finance-space", empty: view.bySpace.length === 0 }} title="By space" description="Booking income against refunds and repairs for each space."><BarList label="By space" items={view.bySpace.map((row) => ({ key: row.key, label: row.label, value: Math.abs(row.income - row.expenses), display: `in ${amount(row.income)} · out ${amount(row.expenses)}` }))} empty="Nothing tied to a space yet." /></ChartFrame>
      {view.canManage ? <Card className="flex flex-col gap-3"><h2 className="text-h3 text-ink">Post an entry</h2><p className="text-ink-secondary">Rent, utilities, supplies or other income. Payments, refunds and repair payouts post themselves.</p>
        <ManualEntryForm makerspaceSlug={slug} currency={view.currency} today={bookingDate(new Date(), view.makerspace.timezone)} /></Card> : null}
    </div>
    <Card padding="none">{view.entries.length === 0 ? <EmptyState mood="sleepy" title="No money moved in this period" /> : <Table label="Ledger">
      <THead><TR><TH>When</TH><TH>What</TH><TH>How</TH><TH className="text-right">Amount</TH><TH>Source</TH></TR></THead>
      <TBody>{view.entries.map((entry) => <TR key={entry.id}>
        <TD className="whitespace-nowrap">{formatDayTime(entry.occurredAt, view.makerspace.timezone)}</TD>
        <TD>{entry.category}{entry.space ? <span className="block text-ink-muted">{entry.space}</span> : null}{entry.note ? <span className="block text-ink-muted">{entry.note}</span> : null}</TD>
        <TD>{entry.method}{entry.reference ? <span className="block text-ink-muted">{entry.reference}</span> : null}</TD>
        <TD className="text-right tabular-nums">{entry.direction === "IN" ? "" : "−"}{money(entry.amountMinor, entry.currency)}</TD>
        <TD>{entry.href ? <Link className="underline underline-offset-4" href={entry.href}>Open</Link> : entry.sourceType === "REVERSAL" ? <Chip size="sm">Reversal</Chip> : entry.reversed ? <Chip size="sm">Reversed</Chip> : null}
          {entry.reversible && view.canManage ? <details className="mt-2"><summary className="cursor-pointer underline underline-offset-4">Reverse</summary><div className="mt-3"><ReverseEntryForm makerspaceSlug={slug} entryId={entry.id} /></div></details> : null}</TD>
      </TR>)}</TBody>
    </Table>}</Card>
    <Pagination page={view.page} pages={view.pages} query={{ period: view.period.preset }} />
  </div>;
}
