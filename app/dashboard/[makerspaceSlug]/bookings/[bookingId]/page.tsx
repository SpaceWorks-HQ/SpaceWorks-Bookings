import { loadBooking } from "@/lib/views/app__dashboard__makerspaceSlug__bookings__bookingId__page";
import { MakerspacePageHeader } from "@/components/dashboard/makerspace/MakerspacePageHeader";
import { BookingActions } from "@/components/bookings/BookingActions";
import { OccurrenceCard } from "@/components/bookings/OccurrenceCard";
import { StaffMoneyPanel } from "@/components/bookings/money/StaffMoneyPanel";
import { Card, Chip, DetailList } from "@/components/ui/display";
import { CollapsibleSection } from "@/components/ui/collapsible";
import { words } from "@/lib/bookings/ui";
import { money } from "@/lib/money/currencies";
import { formatDayTime } from "@/lib/format/datetime";

export const metadata = { title: "Booking details" };
export default async function Page(props: Parameters<typeof loadBooking>[0]) {
  const data = await loadBooking(props);
  const { makerspace, booking } = data;
  const zone = makerspace.timezone;
  return <div className="flex flex-col gap-6"><MakerspacePageHeader makerspace={makerspace} title={booking.reference} description={booking.space.name} />
    <div className="flex flex-wrap gap-3"><Chip>{words(booking.status)}</Chip><Chip>{booking.paymentLabel}</Chip><Chip>{words(booking.rateKind)} rate</Chip></div>
    <Card><DetailList items={[
      ...(data.canContact ? [{ label: "Customer", value: booking.contactName }, { label: "Email", value: booking.contactEmail }, { label: "Phone", value: booking.contactPhone || "Not provided" }] : []),
      { label: "Attendees", value: booking.attendees }, { label: "Quantity", value: booking.quantity }, { label: "Purpose", value: booking.purpose || "Not provided" },
      ...(booking.internalNotes ? [{ label: "Internal notes", value: booking.internalNotes }] : []),
      { label: "Current charge", value: money(booking.chargeMinor, booking.currency) }, { label: "Paid", value: money(booking.paidMinor, booking.currency) },
      { label: "Refunded", value: money(booking.refundedMinor, booking.currency) }, { label: "Balance due", value: money(booking.balanceDue, booking.currency) },
      { label: "Refund due", value: money(booking.refundDue, booking.currency) }, { label: "Payment due", value: booking.balanceDue <= 0 ? "Nothing due" : booking.paymentDueAt ? formatDayTime(booking.paymentDueAt, zone) : "No deadline" },
    ]} /></Card>
    <section className="flex flex-col gap-4"><h2 className="text-h3 text-ink">Occurrences</h2>{booking.occurrences.map((row, index, rows) => <OccurrenceCard key={row.id}
      slug={makerspace.slug} bookingId={booking.id} bookingStatus={booking.status} row={row} timezone={zone} currency={booking.currency} canManage={data.canManage} canOverride={data.canOverride}
      firstUnit={rows.findIndex((item) => item.slotIndex === row.slotIndex) === index} />)}</section>
    <CollapsibleSection id="booking-price" defaultOpen={false} title="Price snapshot" description="Prices and tax recorded when this booking was priced.">
      {booking.lines.length ? booking.lines.map((line, index) => <div className="flex justify-between gap-4 border-b border-line py-3" key={index}>
        <div className="text-ink"><p>{line.description}</p><p className="text-ink-muted">{line.detail}</p></div><p className="text-ink">{money(line.totalMinor, booking.currency)}</p>
      </div>) : <p className="text-ink-muted">No price lines yet. This booking may still be held.</p>}
      <p className="mt-4 font-semibold text-ink">Snapshot total: {money(booking.totalMinor, booking.currency)}</p>
    </CollapsibleSection>
    <StaffMoneyPanel slug={makerspace.slug} bookingId={booking.id} reference={booking.reference} currency={booking.currency} timezone={zone} status={booking.status} paymentDueAt={booking.paymentDueAt} view={data.money} />
    <BookingActions slug={makerspace.slug} booking={booking} spaces={data.spaces} canManage={data.canManage} canApprove={data.canApprove} canOverride={data.canOverride} timezone={zone} />
    <CollapsibleSection id="booking-timeline" defaultOpen={false} title="Booking timeline" count={booking.events.length}>
      <ol className="flex flex-col gap-4">{booking.events.map((event) => <li key={event.id} className="border-l-2 border-line pl-4 text-ink">
        <p className="font-semibold">{words(event.kind.replace(/-/g, "_"))}</p><p className="text-ink-muted">{formatDayTime(event.createdAt, zone)} · {words(event.actorKind)}</p>
        {event.reason ? <p className="mt-1 text-ink-secondary">{event.reason}</p> : null}
      </li>)}</ol>
    </CollapsibleSection>
  </div>;
}
