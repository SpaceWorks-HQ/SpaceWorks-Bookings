import Link from "next/link";
import type { Metadata } from "next";
import { loadReconciliation } from "@/lib/views/app__dashboard__makerspaceSlug__payments__reconciliation__page";
import { MakerspacePageHeader } from "@/components/dashboard/makerspace/MakerspacePageHeader";
import { Card, CardHeader, Chip, EmptyState } from "@/components/ui/display";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { PROVIDER_LABELS } from "@/lib/payments/labels";
import { money } from "@/lib/money/currencies";
import { formatDayTime } from "@/lib/format/datetime";
import { words } from "@/lib/bookings/ui";
import { formatCalendarDate } from "@/lib/calendarDate";

export const metadata: Metadata = { title: "Reconciliation", robots: { index: false, follow: false } };

const provider = (value: string) => PROVIDER_LABELS[value as keyof typeof PROVIDER_LABELS] ?? words(value);
const refundState = (row: { status: string; offlineRequired: boolean; sentAt: string | null; stuck: boolean }) =>
  row.status === "FAILED" ? "Failed" : row.offlineRequired ? "Hand back offline" : row.sentAt ? (row.stuck ? "With the provider for over a day" : "With the provider") : "Waiting to send";

export default async function ReconciliationPage({ params }: { params: Promise<{ makerspaceSlug: string }> }) {
  const view = await loadReconciliation({ params });
  const zone = view.makerspace.timezone;
  const bookingLink = (booking: { id: string; reference: string } | null) => booking
    ? <Link className="underline underline-offset-4" href={`/dashboard/${view.makerspace.slug}/bookings/${booking.id}`}>{booking.reference}</Link> : <span className="text-ink-muted">No booking</span>;
  const nothing = view.open.length + view.flagged.length + view.refunds.length === 0;
  return <div className="flex flex-col gap-6">
    <MakerspacePageHeader makerspace={view.makerspace} title="Reconciliation" description="Money that needs someone, and what came in and went out over the last 14 days." />
    {nothing ? <EmptyState mood="happy" title="Nothing needs you">No open checkouts, flagged payments or refunds waiting.</EmptyState> : null}
    {view.refunds.length ? <Card as="section"><CardHeader title="Refunds to finish" description="Hand back offline refunds and record them on the booking; retry or record failed ones." />
      <Table label="Refunds to finish"><THead><TR><TH>Booking</TH><TH>Customer</TH><TH>Why</TH><TH>State</TH><TH className="text-right">Amount</TH></TR></THead><TBody>
        {view.refunds.map((row) => <TR key={row.id}><TD>{bookingLink(row.payment.booking)}</TD><TD>{row.payment.customerName}</TD><TD>{words(row.kind)}</TD>
          <TD><Chip tone={row.status === "FAILED" || row.stuck ? "danger" : "warning"}>{refundState(row)}</Chip>{row.failureReason ? <span className="block text-ink-muted">{row.failureReason}</span> : null}</TD>
          <TD className="text-right tabular-nums">{money(row.amountMinor, row.currency)}</TD></TR>)}
      </TBody></Table></Card> : null}
    {view.flagged.length ? <Card as="section"><CardHeader title="Payments to review" description="Late, mismatched or extra payments. Each was receipted; refunds already follow where the money wasn't owed." />
      <Table label="Payments to review"><THead><TR><TH>Booking</TH><TH>Customer</TH><TH>Why</TH><TH className="text-right">Amount</TH></TR></THead><TBody>
        {view.flagged.map((row) => <TR key={row.id}><TD>{bookingLink(row.booking)}</TD><TD>{row.customerName}</TD><TD className="max-w-[420px]">{row.flagReason}</TD>
          <TD className="text-right tabular-nums"><Link className="underline underline-offset-4" href={`/dashboard/${view.makerspace.slug}/payments/${row.id}`}>{money(row.capturedMinor ?? row.amountMinor, row.currency)}</Link></TD></TR>)}
      </TBody></Table></Card> : null}
    {view.open.length ? <Card as="section"><CardHeader title="Open checkouts" description="Started more than ten minutes ago and not paid yet. They settle or close on their own; a week later they close as failed." />
      <Table label="Open checkouts"><THead><TR><TH>Booking</TH><TH>Customer</TH><TH>Provider</TH><TH>Started</TH><TH className="text-right">Amount</TH></TR></THead><TBody>
        {view.open.map((row) => <TR key={row.id}><TD>{bookingLink(row.booking)}</TD><TD>{row.customerName}</TD><TD>{provider(row.provider)}</TD><TD>{formatDayTime(row.createdAt, zone)}</TD>
          <TD className="text-right tabular-nums">{money(row.amountMinor, row.currency)}</TD></TR>)}
      </TBody></Table></Card> : null}
    <Card as="section"><CardHeader title="Daily totals" description={`Paid in and refunded per provider, by day in ${zone}.`} />
      {view.days.length === 0 ? <p className="text-ink-muted">No money moved in the last 14 days.</p> : <Table label="Daily totals"><THead><TR><TH>Day</TH><TH>Provider</TH><TH className="text-right">Paid in</TH><TH className="text-right">Refunded</TH><TH className="text-right">Net</TH></TR></THead><TBody>
        {view.days.map((row) => <TR key={`${row.day}-${row.provider}-${row.currency}`}><TD className="whitespace-nowrap">{formatCalendarDate({ year: Number(row.day.slice(0, 4)), month: Number(row.day.slice(5, 7)), day: Number(row.day.slice(8, 10)) })}</TD><TD>{provider(row.provider)}</TD>
          <TD className="text-right tabular-nums">{money(row.inMinor, row.currency)} <span className="text-ink-muted">({row.payments})</span></TD>
          <TD className="text-right tabular-nums">{money(row.outMinor, row.currency)} <span className="text-ink-muted">({row.refunds})</span></TD>
          <TD className="text-right tabular-nums">{money(row.inMinor - row.outMinor, row.currency)}</TD></TR>)}
      </TBody></Table>}
    </Card>
  </div>;
}
