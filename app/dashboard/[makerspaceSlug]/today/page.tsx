import Link from "next/link";
import { loadToday } from "@/lib/views/app__dashboard__makerspaceSlug__today__page";
import { groupBySpace, words } from "@/lib/bookings/ui";
import { formatTimeRange } from "@/lib/format/datetime";
import { MakerspacePageHeader } from "@/components/dashboard/makerspace/MakerspacePageHeader";
import { AttendanceActions } from "@/components/bookings/AttendanceActions";
import { CheckInCodeForm } from "@/components/bookings/CheckInCodeForm";
import { Card, Chip, EmptyState } from "@/components/ui/display";
import { CollapsibleSection } from "@/components/ui/collapsible";
import { AllHerePatch } from "@/components/eggs/BookingEggs";
import { everyoneArrived } from "@/lib/bookings/eggs";

export const metadata = { title: "Today" };
const longDay = (day: string) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

export default async function Page(props: Parameters<typeof loadToday>[0]) {
  const { makerspace, date, canManage, spaces, rows } = await loadToday(props);
  const groups = groupBySpace(rows);
  return <div className="flex flex-col gap-6"><MakerspacePageHeader makerspace={makerspace} title="Today" description={`${longDay(date)} · ${makerspace.timezone}`} />
    {everyoneArrived(rows) ? <Card className="flex items-center gap-4"><AllHerePatch /><p className="text-ink">Everyone due today has checked in.</p></Card> : null}
    {canManage ? <CheckInCodeForm slug={makerspace.slug} /> : null}
    {!rows.length ? <EmptyState title="No bookings today">Confirmed bookings and requests appear here, grouped by space.</EmptyState> : spaces.filter((space) => groups[space.id]?.length).map((space) => <CollapsibleSection key={space.id} id={`today-${space.id}`} title={space.name} count={groups[space.id].length}>
      {groups[space.id].map((row, index, occurrences) => <div key={row.id} className="flex flex-col gap-3 border-b border-line py-4 last:border-0 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
        <div className="min-w-0 flex-1 text-ink"><Link className="sw-hit font-semibold text-accent-text underline-offset-4 hover:underline" href={`/dashboard/${makerspace.slug}/bookings/${row.bookingId}`}>{row.booking.reference}</Link>
          <p>{formatTimeRange(row.startsAt, row.endsAt, makerspace.timezone)} · Unit {row.unit + 1}</p>
          <p>{row.booking.contactName ? `${row.booking.contactName} · ` : ""}{row.booking.attendees} {row.booking.attendees === 1 ? "attendee" : "attendees"}</p></div>
        <div className="flex flex-wrap gap-2"><Chip>{row.noShowAt ? "No-show" : words(row.status)}</Chip><Chip>{words(row.booking.status)}</Chip></div>
        {canManage && occurrences.findIndex((item) => item.bookingId === row.bookingId && item.slotIndex === row.slotIndex) === index && (row.canCheckIn || row.canNoShow) ? <AttendanceActions slug={makerspace.slug} occurrenceId={row.id} noShow={Boolean(row.noShowAt)} canCheckIn={row.canCheckIn} canNoShow={row.canNoShow} /> : null}
      </div>)}
    </CollapsibleSection>)}
  </div>;
}
