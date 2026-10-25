import type { Metadata } from "next";
import { loadRepairLink } from "@/lib/views/app__repair__token__page";
import { AddPhoto, AnswerRequest, RecordFix } from "@/components/repairs/IssueWorkPanel";
import { Callout, Card, CardHeader, Chip, DetailList } from "@/components/ui/display";
import { money } from "@/lib/money/currencies";
import { PAYOUT_LABELS, SEVERITY_LABELS, STATUS_LABELS } from "@/lib/repairs/rules";

export const metadata: Metadata = { title: "Repair request", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

/** An external technician's page: one repair, through their own link. No account and nothing else is shown. */
export default async function RepairLinkPage(props: Parameters<typeof loadRepairLink>[0]) {
  const view = await loadRepairLink(props);
  const { issue } = view;
  const mode = { kind: "link" as const, token: view.token };
  return <div className="mx-auto flex max-w-[760px] flex-col gap-6 px-4 py-10 sm:px-6">
    <div><p className="text-ink-secondary">{view.makerspace} · for {view.technician}</p><h1 className="text-display-m">{issue.title}</h1></div>
    <Card className="flex flex-col gap-4">
      {issue.description ? <p className="whitespace-pre-wrap text-ink">{issue.description}</p> : null}
      <DetailList items={[
        { label: "Space", value: issue.space }, { label: "Priority", value: SEVERITY_LABELS[issue.severity] }, { label: "Reference", value: issue.reference },
        { label: "Status", value: STATUS_LABELS[issue.status] },
        ...(issue.amountAskedMinor !== null ? [{ label: "You asked", value: money(issue.amountAskedMinor, issue.currency) }] : []),
        ...(issue.payout ? [{ label: "Payment", value: <Chip size="sm" tone={issue.payout === "PAID" ? "success" : "warning"}>{PAYOUT_LABELS[issue.payout]}</Chip> }] : []),
      ]} />
      {view.photos.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{view.photos.map((photo) => <a key={photo.id} href={photo.url} target="_blank" rel="noopener">
        {/* eslint-disable-next-line @next/next/no-img-element -- stored WebP derivatives, already sized */}
        <img src={photo.url} alt="Photo of the issue" className="aspect-square w-full rounded-xl object-cover" loading="lazy" /></a>)}</div> : null}
    </Card>
    {view.status === "SENT" ? <Card><CardHeader title="Can you take this repair?" description="The first technician to accept takes it." /><AnswerRequest mode={mode} /></Card> : null}
    {view.status === "ACCEPTED" && issue.status === "ASSIGNED" ? <Card><CardHeader title="Record the repair" description="When you're done, say what you did and what you ask for the work." />
      <RecordFix mode={mode} currency={issue.currency} remarks={issue.fixRemarks} partsUsed={issue.partsUsed} amountAskedMinor={issue.amountAskedMinor} amountLocked={issue.approved} /></Card> : null}
    {view.status === "ACCEPTED" && issue.status === "FIXED" ? <Callout tone="success" title="Thank you">The makerspace will check the work and pay what was agreed.</Callout> : null}
    {view.status === "ACCEPTED" && issue.status !== "CLOSED" ? <Card><CardHeader title="Add a photo" /><AddPhoto mode={mode} /></Card> : null}
  </div>;
}
