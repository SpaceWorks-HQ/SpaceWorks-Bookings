import type { Metadata } from "next";
import { loadIssue } from "@/lib/views/app__dashboard__makerspaceSlug__issues__issueId__page";
import { MakerspacePageHeader } from "@/components/dashboard/makerspace/MakerspacePageHeader";
import { IssueSummary, IssueTimeline } from "@/components/repairs/IssueDetail";
import { AddPhoto, AnswerRequest, RecordFix } from "@/components/repairs/IssueWorkPanel";
import { OutOfService, RequestTechnicians, VerifyIssue } from "@/components/repairs/IssueManagerPanel";
import { IssuePayPanel } from "@/components/repairs/IssuePayPanel";
import { Card, CardHeader } from "@/components/ui/display";
import { CollapsibleSection } from "@/components/ui/collapsible";
import { bookingDate } from "@/lib/bookings/publicUi";
import { formatDayTime } from "@/lib/format/datetime";
import { money } from "@/lib/money/currencies";
import { REQUEST_LABELS } from "@/lib/repairs/rules";

export const metadata: Metadata = { title: "Issue", robots: { index: false, follow: false } };

export default async function IssuePage(props: Parameters<typeof loadIssue>[0]) {
  const view = await loadIssue(props);
  const { issue, flags } = view;
  const slug = view.makerspace.slug;
  const zone = view.makerspace.timezone;
  const mode = { kind: "staff" as const, makerspaceSlug: slug, issueId: issue.id };
  const canWork = (view.mine && flags.work) || flags.manage;
  return <div className="flex flex-col gap-6">
    <MakerspacePageHeader makerspace={view.makerspace} title={issue.title} description={`${issue.reference} · ${issue.space.name}`} />
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="flex flex-col gap-6">
        <IssueSummary issue={issue} photos={view.photos} timezone={zone} />
        <CollapsibleSection id="issue-timeline" title="Timeline" count={view.timeline.length}><IssueTimeline events={view.timeline} timezone={zone} currency={issue.currency} /></CollapsibleSection>
      </div>
      <div className="flex flex-col gap-6">
        {view.myRequest === "SENT" && flags.work ? <Card><CardHeader title="Can you take this repair?" /><AnswerRequest mode={mode} /></Card> : null}
        {issue.status === "ASSIGNED" && canWork ? <Card><CardHeader title="Record the repair" description="Say what you did; the makerspace checks it and pays what was agreed." />
          <RecordFix mode={mode} currency={issue.currency} remarks={issue.fixRemarks} partsUsed={issue.partsUsed} amountAskedMinor={issue.amountAskedMinor} amountLocked={issue.payout !== null && issue.payout !== "TO_APPROVE" && issue.payout !== "NOTHING_ASKED"} /></Card> : null}
        {flags.manage && (issue.status === "REPORTED" || issue.status === "ASSIGNED") ? <Card><CardHeader title="Technicians" />
          <RequestTechnicians makerspaceSlug={slug} issueId={issue.id} directory={view.directory} canRequest={issue.status === "REPORTED"} /></Card> : null}
        {flags.manage && view.requests.length ? <CollapsibleSection id="issue-requests" title="Who was asked" count={view.requests.length}><ul className="flex flex-col gap-2">{view.requests.map((request) => <li key={request.id} className="text-ink">
          {request.technician}: {REQUEST_LABELS[request.status]} <span className="text-ink-muted">· {formatDayTime(request.sentAt, zone)}{request.channels.length ? ` · ${request.channels.join(", ").toLowerCase()}` : ""}</span></li>)}</ul></CollapsibleSection> : null}
        {flags.manage && (issue.status === "FIXED" || issue.status === "CLOSED") ? <Card><CardHeader title="Check the work" /><VerifyIssue makerspaceSlug={slug} issueId={issue.id} status={issue.status} /></Card> : null}
        {flags.pay && (issue.status === "FIXED" || issue.status === "CLOSED") ? <Card><CardHeader title="Payment" description={issue.paidMinor ? `${money(issue.paidMinor, issue.currency)} paid so far.` : undefined} />
          <IssuePayPanel makerspaceSlug={slug} issueId={issue.id} currency={issue.currency} amountAskedMinor={issue.amountAskedMinor} approvedMinor={issue.approvedMinor} paidMinor={issue.paidMinor ?? 0} today={bookingDate(new Date(), zone)} />
          {view.payouts.length ? <ul className="mt-6 flex flex-col gap-2">{view.payouts.map((payout) => <li key={payout.id} className="text-ink">{money(payout.amountMinor, issue.currency)} · {payout.method.replace("_", " ").toLowerCase()}{payout.reference ? ` · ${payout.reference}` : ""} <span className="text-ink-muted">· {formatDayTime(payout.paidAt, zone)}</span></li>)}</ul> : null}
        </Card> : null}
        {flags.manage && issue.status !== "CLOSED" ? <CollapsibleSection id="issue-out-of-service" defaultOpen={issue.outOfService} title="Out of service" description={issue.outOfService ? "New bookings for this space are refused until the date set." : "Stop new bookings while the space can't be used."}>
          <OutOfService makerspaceSlug={slug} issueId={issue.id} active={issue.outOfService} /></CollapsibleSection> : null}
        {issue.status !== "CLOSED" && (flags.viewAll || view.mine) ? <CollapsibleSection id="issue-photo" defaultOpen={false} title="Add a photo"><AddPhoto mode={mode} /></CollapsibleSection> : null}
      </div>
    </div>
  </div>;
}
