import Link from "next/link";
import { loadPublicBookingPage } from "@/lib/views/app__m__makerspaceSlug__bookings__reference__page";
import { Card, Callout } from "@/components/ui/display";
import { buttonClasses } from "@/components/ui/button";
import { CustomerBookingControls } from "@/components/bookings/CustomerBookingControls";
import { CheckInCode } from "@/components/bookings/CheckInCode";
import { words, snapshotLines } from "@/lib/bookings/ui";
import { money } from "@/lib/money/currencies";
import { formatDate, formatTime, formatTimeRange } from "@/lib/format/datetime";

export const metadata = { title: "Your booking", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function PublicBookingPage(props: { params: Promise<{ makerspaceSlug: string; reference: string }>; searchParams: Promise<{ t?: string }> }) {
  const { makerspace, detail } = await loadPublicBookingPage(props);
  const amount = (value: number) => money(value, detail.currency);
  const zone = makerspace.timezone;
  return <div className="mx-auto flex max-w-[1120px] flex-col gap-8 px-4 py-10 sm:px-6"><h1 className="text-display-m">Your booking · {detail.reference}</h1>
    <div className="grid items-start gap-8 lg:grid-cols-2"><Card className="flex flex-col gap-5"><h2 className="text-h1">{detail.space.name}</h2><p>{words(detail.status)} · {detail.paymentLabel}</p>
      {detail.status === "REQUESTED" ? <Callout title="Waiting for approval">The makerspace will review your request and email you their answer. You pay nothing until it is approved.</Callout> : null}
      {detail.awaitingPayment ? <Callout title="Payment pending">{amount(detail.balanceMinor)} is pending. Contact {makerspace.name} using the details below to arrange payment.{detail.holdExpiresAt ? ` Your hold ends ${formatDate(detail.holdExpiresAt, zone)}, ${formatTime(detail.holdExpiresAt, zone)}.` : ""}</Callout> : null}
      {!detail.awaitingPayment && detail.balanceMinor > 0 && detail.status === "CONFIRMED" ? <Callout title="Payment pending">{amount(detail.balanceMinor)} is due{detail.paymentDueAt ? ` by ${formatDate(detail.paymentDueAt, zone)}, ${formatTime(detail.paymentDueAt, zone)}` : ""}. Contact the makerspace to arrange payment.</Callout> : null}
      {detail.declineReason || detail.cancelReason ? <p className="whitespace-pre-wrap">{detail.declineReason || detail.cancelReason}</p> : null}
      <section><h2 className="text-h2">Booking times</h2><p className="text-ink-secondary">{zone} · Quantity {detail.quantity}</p><ul className="mt-3 flex flex-col gap-3">{detail.slots.map((row) => <li key={row.id}>{formatDate(row.startsAt, zone)} · {formatTimeRange(row.startsAt, row.endsAt, zone)} · {words(row.status)}</li>)}</ul></section>
      <section><h2 className="text-h2">Price</h2><ul className="my-3 flex flex-col gap-2">{snapshotLines(detail.priceSnapshot).map((line, index) => <li key={index} className="flex justify-between gap-4"><span>{line.description}<small className="block text-ink-secondary">{line.detail}</small></span><span>{amount(line.totalMinor)}</span></li>)}</ul>
        <p>Total price: {amount(detail.totalMinor)}</p><p>Current amount owed: {amount(detail.chargeMinor)}</p><p>Balance due: {amount(detail.balanceMinor)}</p></section>
      <a href={`/api/bookings/${makerspace.slug}/${detail.reference}/calendar${detail.manageToken ? `?t=${encodeURIComponent(detail.manageToken)}` : ""}`} download className={buttonClasses({ variant: "secondary" })}>Add to calendar (ICS)</a>
      {detail.code ? <CheckInCode code={detail.code} /> : null}
      <section><h2 className="text-h2">Contact {makerspace.name}</h2>{makerspace.contactEmail ? <a className="block underline" href={`mailto:${makerspace.contactEmail}`}>{makerspace.contactEmail}</a> : null}{makerspace.contactPhone ? <a className="block underline" href={`tel:${makerspace.contactPhone}`}>{makerspace.contactPhone}</a> : null}
        {!makerspace.contactEmail && !makerspace.contactPhone ? <Link className="underline" href={`/m/${makerspace.slug}`}>Visit the makerspace page for contact details</Link> : null}</section>
    </Card><Card><CustomerBookingControls slug={makerspace.slug} bookingId={detail.id} manageToken={detail.manageToken} currency={detail.currency} cancellations={detail.cancellations}
      slots={detail.slots.map((row) => ({ id: row.id, startsAt: row.startsAt.toISOString(), canMove: row.canMove }))} spaceId={detail.space.id} units={detail.quantity} zone={zone} today={detail.today} rules={detail.rules} /></Card></div>
  </div>;
}
