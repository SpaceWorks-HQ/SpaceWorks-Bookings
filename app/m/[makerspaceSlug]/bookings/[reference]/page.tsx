import Link from "next/link";
import { loadPublicBookingPage } from "@/lib/views/app__m__makerspaceSlug__bookings__reference__page";
import { Card, Callout } from "@/components/ui/display";
import { buttonClasses } from "@/components/ui/button";
import { CustomerBookingControls } from "@/components/bookings/CustomerBookingControls";
import { CheckInCode } from "@/components/bookings/CheckInCode";
import { PayPanel } from "@/components/bookings/money/PayPanel";
import { BookedStamp } from "@/components/eggs/BookingEggs";
import { showBookedStamp } from "@/lib/bookings/eggs";
import { words, snapshotLines } from "@/lib/bookings/ui";
import { money } from "@/lib/money/currencies";
import { formatDate, formatTime, formatTimeRange } from "@/lib/format/datetime";

export const metadata = { title: "Your booking", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function PublicBookingPage(props: { params: Promise<{ makerspaceSlug: string; reference: string }>; searchParams: Promise<{ t?: string }> }) {
  const { makerspace, detail, payment } = await loadPublicBookingPage(props);
  const tokenQuery = detail.manageToken ? `?t=${encodeURIComponent(detail.manageToken)}` : "";
  const amount = (value: number) => money(value, detail.currency);
  const zone = makerspace.timezone;
  return <div className="mx-auto flex max-w-[1120px] flex-col gap-8 px-4 py-10 sm:px-6"><div className="flex flex-wrap items-center gap-6"><h1 className="text-display-m">Your booking · {detail.reference}</h1>{showBookedStamp(detail, new Date()) ? <BookedStamp /> : null}</div>
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 lg:grid-cols-2"><Card className="flex flex-col gap-5"><h2 className="text-h1">{detail.space.name}</h2><p>{words(detail.status)} · {detail.paymentLabel}</p>
      {detail.status === "REQUESTED" ? <Callout title="Waiting for approval">The makerspace will review your request and email you their answer. You pay nothing until it is approved.</Callout> : null}
      <PayPanel slug={makerspace.slug} bookingId={detail.id} manageToken={detail.manageToken} currency={detail.currency} makerspaceName={makerspace.name} payment={payment}
        dueText={detail.awaitingPayment && detail.holdExpiresAt ? `Pay to confirm your booking. Your hold ends ${formatDate(detail.holdExpiresAt, zone)}, ${formatTime(detail.holdExpiresAt, zone)}.` : detail.balanceMinor > 0 && detail.paymentDueAt ? `${amount(detail.balanceMinor)} is due by ${formatDate(detail.paymentDueAt, zone)}, ${formatTime(detail.paymentDueAt, zone)}.` : null} />
      {detail.declineReason || detail.cancelReason ? <p className="whitespace-pre-wrap">{detail.declineReason || detail.cancelReason}</p> : null}
      <section><h2 className="text-h2">Booking times</h2><p className="text-ink-secondary">{zone} · Quantity {detail.quantity}</p><ul className="mt-3 flex flex-col gap-3">{detail.slots.map((row) => <li key={row.id}>{formatDate(row.startsAt, zone)} · {formatTimeRange(row.startsAt, row.endsAt, zone)} · {words(row.status)}</li>)}</ul></section>
      <section><h2 className="text-h2">Price</h2><ul className="my-3 flex flex-col gap-2">{snapshotLines(detail.priceSnapshot).map((line, index) => <li key={index} className="flex justify-between gap-4"><span>{line.description}<small className="block text-ink-secondary">{line.detail}</small></span><span>{amount(line.totalMinor)}</span></li>)}</ul>
        <p>Total price: {amount(detail.totalMinor)}</p><p>Current amount owed: {amount(detail.chargeMinor)}</p><p>Balance due: {amount(detail.balanceMinor)}</p></section>
      <div className="flex flex-wrap gap-3"><a href={`/api/bookings/${makerspace.slug}/${detail.reference}/calendar${tokenQuery}`} download className={buttonClasses({ variant: "secondary" })}>Add to calendar (ICS)</a>
        <a href={`/api/bookings/${makerspace.slug}/${detail.reference}/statement${tokenQuery}`} target="_blank" rel="noopener" className={buttonClasses({ variant: "secondary" })}>Statement (PDF)</a></div>
      {detail.code ? <CheckInCode code={detail.code} selfAccess={detail.selfCheckIn ? { makerspaceSlug: makerspace.slug, ...(detail.manageToken ? { manageToken: detail.manageToken } : { bookingId: detail.id }) } : undefined} /> : null}
      <section><h2 className="text-h2">Contact {makerspace.name}</h2>{makerspace.contactEmail ? <a className="block underline" href={`mailto:${makerspace.contactEmail}`}>{makerspace.contactEmail}</a> : null}{makerspace.contactPhone ? <a className="block underline" href={`tel:${makerspace.contactPhone}`}>{makerspace.contactPhone}</a> : null}
        {!makerspace.contactEmail && !makerspace.contactPhone ? <Link className="underline" href={`/m/${makerspace.slug}`}>Visit the makerspace page for contact details</Link> : null}</section>
    </Card><Card><CustomerBookingControls slug={makerspace.slug} bookingId={detail.id} manageToken={detail.manageToken} currency={detail.currency} cancellations={detail.cancellations}
      slots={detail.slots.map((row) => ({ id: row.id, startsAt: row.startsAt.toISOString(), canMove: row.canMove }))} spaceId={detail.space.id} units={detail.quantity} zone={zone} today={detail.today} rules={detail.rules} /></Card></div>
  </div>;
}
