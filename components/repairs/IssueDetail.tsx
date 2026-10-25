import { Card, Chip, DetailList } from "@/components/ui/display";
import { formatDayTime } from "@/lib/format/datetime";
import { money } from "@/lib/money/currencies";
import { PAYOUT_LABELS, SEVERITY_LABELS, STATUS_LABELS, type PayoutState } from "@/lib/repairs/rules";
import type { IssueSeverity, IssueStatus } from "@prisma/client";

const EVENT_WORDS: Record<string, string> = {
  reported: "reported the issue", requested: "asked", accepted: "accepted the repair", declined: "declined", assigned: "assigned", "request-expired": "didn't answer in time:",
  fixed: "recorded the repair", closed: "verified and closed it", reopened: "reopened it", approved: "approved the amount", paid: "recorded a payout",
  photo: "added a photo", "out-of-service": "blocked bookings", "back-in-service": "opened the space for bookings again",
};

type Summary = {
  severity: IssueSeverity; status: IssueStatus; description: string; reporterKind: string; createdAt: string; technician: { name: string } | null;
  fixRemarks: string; partsUsed: string; fixedAt: string | null; currency: string; amountAskedMinor: number | null; approvedMinor: number | null; payout: PayoutState | null;
};

/** What is wrong, who holds it, the work recorded and, where the viewer may see it, the money. */
export function IssueSummary({ issue, photos, timezone }: { issue: Summary; photos: Array<{ id: string; url: string }>; timezone: string }) {
  const items = [
    { label: "Status", value: STATUS_LABELS[issue.status] },
    { label: "Priority", value: SEVERITY_LABELS[issue.severity] },
    { label: "Reported", value: `${formatDayTime(issue.createdAt, timezone)} by ${issue.reporterKind === "CUSTOMER" ? "a customer" : "the team"}` },
    { label: "Technician", value: issue.technician?.name ?? "Not yet" },
    ...(issue.fixedAt ? [{ label: "Fixed", value: formatDayTime(issue.fixedAt, timezone) }] : []),
    ...(issue.amountAskedMinor !== null ? [{ label: "Asked for the work", value: money(issue.amountAskedMinor, issue.currency) }] : []),
    ...(issue.approvedMinor !== null ? [{ label: "Approved", value: money(issue.approvedMinor, issue.currency) }] : []),
    ...(issue.payout ? [{ label: "Payment", value: <Chip size="sm" tone={issue.payout === "PAID" ? "success" : "warning"}>{PAYOUT_LABELS[issue.payout]}</Chip> }] : []),
  ];
  return <Card className="flex flex-col gap-4">
    {issue.description ? <p className="whitespace-pre-wrap text-ink">{issue.description}</p> : null}
    <DetailList items={items} />
    {issue.fixRemarks ? <section><h2 className="text-h4 text-ink">What was done</h2><p className="whitespace-pre-wrap text-ink">{issue.fixRemarks}</p>
      {issue.partsUsed ? <p className="mt-2 whitespace-pre-wrap text-ink-secondary">Parts: {issue.partsUsed}</p> : null}</section> : null}
    {photos.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{photos.map((photo) => <a key={photo.id} href={photo.url} target="_blank" rel="noopener">
      {/* eslint-disable-next-line @next/next/no-img-element -- stored WebP derivatives, already sized */}
      <img src={photo.url} alt="Photo of the issue" className="aspect-square w-full rounded-xl object-cover" loading="lazy" /></a>)}</div> : null}
  </Card>;
}

export function IssueTimeline({ events, timezone, currency }: { events: Array<{ id: string; kind: string; createdAt: string; who: string; technician: string | null; data: Record<string, unknown> }>; timezone: string; currency: string }) {
  return <ol className="flex flex-col gap-3">{events.map((event) => {
    const amount = typeof event.data.amountMinor === "number" ? ` (${money(event.data.amountMinor, currency)})` : "";
    const target = ["requested", "assigned", "request-expired"].includes(event.kind) && event.technician ? ` ${event.technician}` : "";
    const reason = typeof event.data.reason === "string" ? `: ${event.data.reason}` : "";
    return <li key={event.id} className="text-ink">{event.who} {EVENT_WORDS[event.kind] ?? event.kind}{target}{amount}{reason}
      <span className="block text-caption text-ink-muted">{formatDayTime(event.createdAt, timezone)}</span></li>;
  })}</ol>;
}
