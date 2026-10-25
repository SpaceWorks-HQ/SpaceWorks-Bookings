import type { Metadata } from "next";
import { loadAuditLog } from "@/lib/views/app__dashboard__makerspaceSlug__audit__page";
import { MakerspacePageHeader } from "@/components/dashboard/makerspace/MakerspacePageHeader";
import { Pagination } from "@/components/bookings/Pagination";
import { Card, EmptyState } from "@/components/ui/display";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Field, Dropdown } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { formatDayTime } from "@/lib/format/datetime";
import { auditWords } from "@/lib/bookings/ui";

export const metadata: Metadata = { title: "Audit log", robots: { index: false, follow: false } };

export default async function AuditPage(props: Parameters<typeof loadAuditLog>[0]) {
  const view = await loadAuditLog(props);
  return <div className="flex flex-col gap-6">
    <MakerspacePageHeader makerspace={view.makerspace} title="Audit log" description="Who changed what: settings, money, team and integrations." />
    <form className="flex flex-wrap items-end gap-3" method="get">
      <Field label="Action"><Dropdown name="action" defaultValue={view.action}><option value="">All actions</option>{view.actions.map((action) => <option key={action} value={action}>{auditWords(action)}</option>)}</Dropdown></Field>
      <Button type="submit" variant="secondary">Filter</Button>
    </form>
    {view.events.length === 0 ? <EmptyState mood="sleepy" title="Nothing recorded yet">Changes appear here as the team works.</EmptyState> : <Card padding="none"><Table label="Audit log" className="min-w-[640px]" sticky>
      <THead><TR><TH>When</TH><TH>Who</TH><TH>Action</TH><TH>Details</TH></TR></THead>
      <TBody>{view.events.map((event) => <TR key={event.id}><TD className="whitespace-nowrap">{formatDayTime(event.createdAt, view.makerspace.timezone)}</TD><TD>{event.actor}</TD>
        <TD><span className="block">{auditWords(event.action)}</span><span className="block text-ink-muted">{event.target}</span></TD><TD className="max-w-[420px] text-ink-secondary">{event.details}</TD></TR>)}</TBody>
    </Table></Card>}
    <Pagination page={view.page} pages={view.pages} query={{ action: view.action || undefined }} />
  </div>;
}
