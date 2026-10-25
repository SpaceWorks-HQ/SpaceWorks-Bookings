import Link from "next/link";
import type { Metadata } from "next";
import { loadIssues } from "@/lib/views/app__dashboard__makerspaceSlug__issues__page";
import { MakerspacePageHeader } from "@/components/dashboard/makerspace/MakerspacePageHeader";
import { Pagination } from "@/components/bookings/Pagination";
import { ReportIssueForm } from "@/components/repairs/ReportIssueForm";
import { Card, Chip, EmptyState } from "@/components/ui/display";
import { NavTabs } from "@/components/ui/tabs";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { buttonClasses } from "@/components/ui/button";
import { formatDayTime } from "@/lib/format/datetime";
import { PAYOUT_LABELS, REQUEST_LABELS, SEVERITY_LABELS, STATUS_LABELS } from "@/lib/repairs/rules";

export const metadata: Metadata = { title: "Issues", robots: { index: false, follow: false } };

const SEVERITY_TONES = { LOW: "neutral", MEDIUM: "info", HIGH: "warning", URGENT: "danger" } as const;

export default async function IssuesPage(props: Parameters<typeof loadIssues>[0]) {
  const view = await loadIssues(props);
  const base = `/dashboard/${view.makerspace.slug}/issues`;
  const tabs = [{ value: "", label: "Open" }, { value: "REPORTED", label: "Reported" }, { value: "ASSIGNED", label: "Assigned" }, { value: "FIXED", label: "To verify" }, { value: "CLOSED", label: "Closed" }];
  return <div className="flex flex-col gap-6">
    <MakerspacePageHeader makerspace={view.makerspace} title={view.flags.viewAll ? "Issues" : "My repairs"}
      description={view.flags.viewAll ? "Problems with a space, from report to paid repair." : "The repairs you have been asked to do."}
      actions={view.flags.manage ? <Link className={buttonClasses({ variant: "secondary" })} href={`/dashboard/${view.makerspace.slug}/technicians`}>Technicians</Link> : undefined} />
    <NavTabs label="Status" items={tabs.map((tab) => ({ href: tab.value ? `${base}?status=${tab.value}` : base, label: tab.label, active: view.status === tab.value }))} />
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Card padding="none">{view.issues.length === 0 ? <EmptyState mood="happy" title="Nothing here">No issues with this status.</EmptyState> : <Table label="Issues">
        <THead><TR><TH>Issue</TH><TH>Space</TH><TH>Priority</TH><TH>Status</TH><TH>Technician</TH></TR></THead>
        <TBody>{view.issues.map((issue) => <TR key={issue.id}>
          <TD><Link className="font-semibold text-ink underline underline-offset-4" href={`${base}/${issue.id}`}>{issue.title}</Link><span className="block text-ink-muted">{issue.reference} · {formatDayTime(issue.createdAt, view.makerspace.timezone)}</span></TD>
          <TD>{issue.space}</TD>
          <TD><Chip size="sm" tone={SEVERITY_TONES[issue.severity]}>{SEVERITY_LABELS[issue.severity]}</Chip></TD>
          <TD>{STATUS_LABELS[issue.status]}{issue.myRequest && !view.flags.viewAll ? <span className="block text-ink-muted">{REQUEST_LABELS[issue.myRequest]}</span> : null}{issue.payout ? <span className="block text-ink-muted">{PAYOUT_LABELS[issue.payout]}</span> : null}</TD>
          <TD>{issue.technician ?? "Not yet"}</TD>
        </TR>)}</TBody>
      </Table>}</Card>
      {view.flags.report && view.spaces.length ? <Card className="flex flex-col gap-3"><h2 className="text-h3 text-ink">Report an issue</h2>
        <ReportIssueForm staff={{ makerspaceSlug: view.makerspace.slug, spaces: view.spaces }} /></Card> : null}
    </div>
    <Pagination page={view.page} pages={view.pages} query={{ status: view.status || undefined }} />
  </div>;
}
