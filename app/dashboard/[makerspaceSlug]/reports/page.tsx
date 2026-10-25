import Link from "next/link";
import type { Metadata } from "next";
import { loadReports } from "@/lib/views/app__dashboard__makerspaceSlug__reports__page";
import { MakerspacePageHeader } from "@/components/dashboard/makerspace/MakerspacePageHeader";
import { BarList } from "@/components/reports/charts/BarList";
import { ColumnChart } from "@/components/reports/charts/ColumnChart";
import { ChartFrame } from "@/components/reports/charts/ChartFrame";
import { KpiTile } from "@/components/reports/charts/Figures";
import { NavTabs } from "@/components/ui/tabs";
import { buttonClasses } from "@/components/ui/button";
import { money } from "@/lib/money/currencies";
import { words } from "@/lib/bookings/ui";

export const metadata: Metadata = { title: "Reports", robots: { index: false, follow: false } };

const PRESET_LABELS: Record<string, string> = { fy: "This year", "last-fy": "Last year", "12m": "12 months", "90d": "90 days", "30d": "30 days", month: "This month" };
const percent = (value: number | null) => (value === null ? "No data" : `${Math.round(value * 100)}%`);
const hours = (minutes: number) => `${Math.round(minutes / 60).toLocaleString("en-IN")} h`;

export default async function ReportsPage(props: Parameters<typeof loadReports>[0]) {
  const view = await loadReports(props);
  const base = `/dashboard/${view.makerspace.slug}/reports`;
  const total = Object.values(view.statuses).reduce((sum, count) => sum + count, 0);
  const exportSuffix = view.exportQuery ? `?${view.exportQuery}` : "";
  return <div className="flex flex-col gap-6">
    <MakerspacePageHeader makerspace={view.makerspace} title="Reports" description={`${view.period.label}. Times use ${view.makerspace.timezone}.`}
      actions={<div className="flex flex-wrap gap-3">
        <a className={buttonClasses({ variant: "secondary" })} href={`/api/exports/bookings/${view.makerspace.slug}${exportSuffix}`}>Export bookings (CSV)</a>
        {view.finance ? <a className={buttonClasses({ variant: "secondary" })} href={`/api/exports/payments/${view.makerspace.slug}${exportSuffix}`}>Export payments (CSV)</a> : null}
        {view.finance ? <a className={buttonClasses({ variant: "secondary" })} href={`/api/exports/repairs/${view.makerspace.slug}${exportSuffix}`}>Export repairs (CSV)</a> : null}
      </div>} />
    <NavTabs label="Period" items={view.presets.map((preset) => ({ href: `${base}?period=${preset}`, label: PRESET_LABELS[preset] ?? preset, active: view.period.preset === preset }))} />
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <KpiTile label="Bookings" value={total} href={`/dashboard/${view.makerspace.slug}/bookings`} />
      <KpiTile label="Utilisation" value={view.overall} format="percent" hint="Booked time over open time" />
      <KpiTile label="No-show rate" value={view.noShows.rate} format="percent" hint={`${view.noShows.noShows} of ${view.noShows.noShows + view.noShows.attended} visits`} />
      {view.finance ? <KpiTile label="Received" value={view.revenueSeries.reduce((sum, value) => sum + value, 0)} format={`money:${view.currency}`} /> : <KpiTile label="Cancelled" value={view.statuses.CANCELLED ?? 0} />}
    </div>
    <ChartFrame collapse={{ id: "reports-utilisation", empty: view.perSpace.length === 0 }} title="Utilisation by space" description="Booked hours over open hours (every unit of a space counts).">
      <BarList label="Utilisation by space" max={100} items={view.perSpace.map((row) => ({ key: row.spaceId, label: row.name, value: Math.round((row.ratio ?? 0) * 100), display: `${percent(row.ratio)} · ${hours(row.bookedMinutes)} of ${hours(row.openMinutes)}` }))} />
    </ChartFrame>
    <ChartFrame collapse={{ id: "reports-new-bookings", empty: total === 0 }} title="New bookings" description="Bookings made in each part of the period.">
      <ColumnChart ariaLabel="New bookings" labels={view.buckets} series={[{ key: "bookings", label: "Bookings", slot: 1, values: view.bookingsSeries }]} />
    </ChartFrame>
    <ChartFrame collapse={{ id: "reports-statuses", empty: total === 0 }} title="Bookings by status">
      <BarList label="Bookings by status" items={Object.entries(view.statuses).map(([status, count]) => ({ key: status, label: words(status), value: count }))} />
    </ChartFrame>
    {view.finance ? <>
      <ChartFrame collapse={{ id: "reports-money", empty: view.revenueSeries.every((value) => value === 0) }} title="Money received" description={`Payments in ${view.currency}, by when they were paid.`}>
        <ColumnChart ariaLabel="Money received" format={`money:${view.currency}`} labels={view.buckets} series={[{ key: "received", label: "Received", slot: 2, values: view.revenueSeries }]} />
      </ChartFrame>
      <ChartFrame collapse={{ id: "reports-ways", empty: view.received.length === 0 }} title="Ways of paying"><BarList label="Ways of paying" items={view.received.map((row) => ({ key: `${row.method}-${row.currency}`, label: words(row.method), value: row.amountMinor, display: `${money(row.amountMinor, row.currency)} · ${row.count}` }))} /></ChartFrame>
      <ChartFrame collapse={{ id: "reports-repairs", empty: view.spaceRepairs.every((row) => !row.revenue && !row.repairs) }} title="Repairs against revenue" description="For each space: booking income less refunds, and what its repairs cost.">
        <BarList label="Repairs against revenue" items={view.spaceRepairs.map((row) => ({ key: row.spaceId, label: row.name, value: Math.max(0, row.revenue), display: `revenue ${money(row.revenue, view.currency)} · repairs ${money(row.repairs, view.currency)}` }))} empty="No space earned or cost anything in this period." />
      </ChartFrame>
      <ChartFrame collapse={{ id: "reports-refunds", empty: view.refunds.length === 0 }} title="Refunds by reason"><BarList label="Refunds by reason" items={view.refunds.map((row) => ({ key: `${row.kind}-${row.currency}`, label: words(row.kind), value: row.amountMinor, display: `${money(row.amountMinor, row.currency)} · ${row.count}` }))} empty="No refunds in this period." /></ChartFrame>
      <p className="text-ink-secondary">Receipts, credit notes and GST figures are on <Link className="underline underline-offset-4" href={`/dashboard/${view.makerspace.slug}/payments`}>Payments</Link>.</p>
    </> : null}
  </div>;
}
