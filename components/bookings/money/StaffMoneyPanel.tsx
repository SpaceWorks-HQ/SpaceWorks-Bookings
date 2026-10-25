import { Card, CardHeader, Chip, Callout } from "@/components/ui/display";
import { money } from "@/lib/money/currencies";
import { formatDayTime } from "@/lib/format/datetime";
import { words } from "@/lib/bookings/ui";
import type { BookingMoneyView } from "@/lib/bookings/money/view";
import { MoneyActions } from "./MoneyActions";
import { RefundRowActions } from "./RefundRowActions";

const REFUND_KIND: Record<string, string> = {
  POLICY: "Cancellation policy", VENUE: "Venue cancelled", MANUAL: "By the team", RESCHEDULE: "Cheaper time",
  DUPLICATE: "Paid twice", LATE_CAPTURE: "Paid too late", EXTERNAL: "In the provider's dashboard",
};
const PURPOSE: Record<string, string> = { FULL: "Payment", DEPOSIT: "Deposit", BALANCE: "Balance", DIFFERENCE: "Difference" };
const refundStatus = (refund: BookingMoneyView["refunds"][number]) =>
  refund.status === "PROCESSED" ? "Refunded" : refund.status === "FAILED" ? (refund.retried ? "Failed, retried" : "Failed") : refund.offlineRequired ? "Hand back offline" : refund.sentAt ? "With the provider" : "Sending";

/** Payments, refunds and the team's money actions on a booking (staff booking page). */
export function StaffMoneyPanel({ slug, bookingId, reference, currency, timezone, status, paymentDueAt, view }: {
  slug: string; bookingId: string; reference: string; currency: string; timezone: string; status: string; paymentDueAt: string | null; view: BookingMoneyView;
}) {
  if (!view.canView) return null;
  const amount = (minor: number) => money(minor, currency);
  return <Card as="section" id="money"><CardHeader title="Money" description="Every payment and refund for this booking. Receipts and credit notes open as PDFs."
    action={<a href={`/api/bookings/${slug}/${reference}/statement`} target="_blank" rel="noopener" className="sw-hit text-ink underline underline-offset-4">Statement (PDF)</a>} />
    {view.writtenOffAt ? <Callout tone="warning" title="Written off">{view.writtenOffReason}</Callout> : null}
    {view.concessionMinor ? <p className="text-ink-secondary">The team gave back {amount(view.concessionMinor)} beyond what was due.</p> : null}
    <h3 className="mt-2 text-h4 text-ink">Payments</h3>
    {view.payments.length === 0 ? <p className="text-ink-muted">No payments yet.</p> : <ul className="flex flex-col">{view.payments.map((payment) => <li key={payment.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3">
      <div className="flex flex-col gap-1 text-ink">
        <p className="font-semibold">{PURPOSE[payment.purpose ?? "FULL"] ?? "Payment"} · {payment.method ? words(payment.method) : words(payment.provider)}</p>
        <p className="text-ink-muted">{formatDayTime(payment.paidAt ?? payment.createdAt, timezone)}{payment.documents.map((document) => <span key={document.id}> · <a className="underline underline-offset-4" href={`/api/documents/${document.id}`} target="_blank" rel="noopener">{document.number}</a></span>)}</p>
        {payment.flaggedAt ? <p className="text-ink-secondary">{payment.flagReason}</p> : null}
      </div>
      <div className="flex items-center gap-3"><Chip>{words(payment.status)}</Chip><span className="tabular-nums text-ink">{amount(payment.capturedMinor ?? payment.amountMinor)}</span></div>
    </li>)}</ul>}
    <h3 className="mt-6 text-h4 text-ink">Refunds</h3>
    {view.refunds.length === 0 ? <p className="text-ink-muted">No refunds.</p> : <ul className="flex flex-col">{view.refunds.map((refund) => <li key={refund.id} className="flex flex-col gap-2 border-b border-line py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1 text-ink">
          <p className="font-semibold">{REFUND_KIND[refund.kind] ?? words(refund.kind)}</p>
          <p className="text-ink-muted">{formatDayTime(refund.processedAt ?? refund.createdAt, timezone)} · {refund.reason}{refund.document ? <> · <a className="underline underline-offset-4" href={`/api/documents/${refund.document.id}`} target="_blank" rel="noopener">{refund.document.number}</a></> : null}</p>
          {refund.method ? <p className="text-ink-secondary">Handed back by {words(refund.method)}{refund.reference ? ` (${refund.reference})` : ""}</p> : null}
          {refund.failureReason ? <p className="text-ink-secondary">{refund.failureReason}</p> : refund.flaggedAt ? <p className="text-ink-secondary">{refund.flagReason}</p> : null}
        </div>
        <div className="flex items-center gap-3"><Chip>{refundStatus(refund)}</Chip><span className="tabular-nums text-ink">{amount(refund.amountMinor)}</span></div>
      </div>
      {view.canRefund ? <RefundRowActions slug={slug} bookingId={bookingId} refundId={refund.id} canRetry={refund.status === "FAILED" && !refund.retried} canRecordOffline={refund.canRecordOffline} /> : null}
    </li>)}</ul>}
    <MoneyActions slug={slug} bookingId={bookingId} currency={currency} status={status} dueMinor={view.dueMinor} paymentDueAt={paymentDueAt}
      canRecord={view.canRecord} canRefund={view.canRefund} canChangeDue={view.canChangeDue} writtenOff={Boolean(view.writtenOffAt)} timezone={timezone} />
  </Card>;
}
