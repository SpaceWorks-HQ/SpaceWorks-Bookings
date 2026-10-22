import Link from "next/link";
import type { Metadata } from "next";
import { loadOrgReportsApplications } from "@/lib/views/app__dashboard__orgSlug__reports__applications__page";
import type { ReportSearch } from "@/lib/reports/context";
import { formatHours, formatValue } from "@/lib/reports/chartScale";
import { ExportLink, ReportShell } from "@/components/reports/ReportShell";
import { BarList } from "@/components/reports/charts/BarList";
import { ChartFrame } from "@/components/reports/charts/ChartFrame";
import { ColumnChart } from "@/components/reports/charts/ColumnChart";
import { KpiTile } from "@/components/reports/charts/Figures";
import { buttonClasses } from "@/components/ui/button";
import { Chip, EmptyState } from "@/components/ui/display";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata: Metadata = { title: "Application reports", robots: { index: false, follow: false } };

type Props = { params: Promise<{ orgSlug: string }>; searchParams: Promise<ReportSearch> };

export default async function OrgReportsApplicationsPage({ params, searchParams }: Props) {
  const view = await loadOrgReportsApplications({ params, searchParams });
  const { stats, shell } = view;
  const slug = shell.org.slug;
  return (
    <ReportShell shell={shell} title="Applications">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3">
        <KpiTile label="Waiting now" value={stats.waiting} hint={stats.waitingOver7Days ? `${stats.waitingOver7Days} for over 7 days` : "None over 7 days"} href={`/dashboard/${slug}/members?status=approval`} />
        <KpiTile label="Received" value={stats.received} hint="Applications in the period" />
        <KpiTile label="Time to approve" value={null} display={formatHours(stats.medianHoursToApprove)} hint={`Median. 9 in 10 within ${formatHours(stats.p90HoursToApprove)}`} />
        <KpiTile label="Approval rate" value={stats.approvalRate} format="percent" hint={`${stats.approved} approved, ${stats.rejected} declined${stats.withdrawn ? `, ${stats.withdrawn} withdrawn` : ""}`} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartFrame title="Join funnel" description="New memberships started in the period, followed to today. Each step shows how many dropped off." table={{ columns: ["Step", "People", "Dropped off"], rows: view.funnel.map((step) => [step.label, step.count, formatValue(step.dropOff, "percent")]) }}>
          <BarList label="Join funnel" ordinal items={view.funnel.map((step) => ({ key: step.key, label: step.label, value: step.count, hint: step.dropOff !== null ? `${formatValue(step.dropOff, "percent")} dropped off before this step` : undefined }))} />
        </ChartFrame>
        <ChartFrame title="Received and approved" table={{ columns: ["Period", "Received", "Approved"], rows: view.series.map((p) => [p.label, p.received, p.approved]) }}>
          <ColumnChart ariaLabel="Applications received and approved" labels={view.series.map((p) => p.label)} series={[{ key: "received", label: "Received", slot: 1, values: view.series.map((p) => p.received) }, { key: "approved", label: "Approved", slot: 3, values: view.series.map((p) => p.approved) }]} />
        </ChartFrame>
      </div>

      <section aria-labelledby="queue-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="queue-title" className="text-h4 text-ink">Approvals queue</h2>
            <p className="text-label text-ink-muted">Oldest first. Decide from the member directory.</p>
          </div>
          <div className="flex gap-2">
            {shell.canExport ? <ExportLink shell={shell} report="approvals" /> : null}
            {view.canDecide ? <Link href={`/dashboard/${slug}/members?status=approval`} className={buttonClasses({ size: "sm" })}>Review applications</Link> : null}
          </div>
        </div>
        {view.queue.length ? (
          <Table label="Applications waiting">
            <THead><tr><TH>Applicant</TH><TH>Plan</TH><TH>Waiting</TH></tr></THead>
            <TBody>
              {view.queue.map((row) => (
                <TR key={row.termId}>
                  <TD><Link href={`/dashboard/${slug}/members/${row.memberId}`} className="font-semibold text-ink underline-offset-4 hover:underline">{row.name}</Link><span className="block text-caption text-ink-muted">#{row.memberNumber}</span></TD>
                  <TD className="text-ink-secondary">{row.plan}</TD>
                  <TD className="whitespace-nowrap">{row.waitingDays > 7 ? <Chip size="sm" tone="warning">{row.waitingDays} days</Chip> : <span className="text-ink-secondary">{row.waitingDays === 0 ? "Today" : `${row.waitingDays} ${row.waitingDays === 1 ? "day" : "days"}`}</span>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : <EmptyState mood="sleepy" title="Queue is clear">No applications are waiting for a decision.</EmptyState>}
      </section>
    </ReportShell>
  );
}
