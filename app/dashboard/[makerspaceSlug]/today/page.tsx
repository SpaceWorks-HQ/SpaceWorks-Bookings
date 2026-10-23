import Link from "next/link";
import { loadToday } from "@/lib/views/app__dashboard__makerspaceSlug__today__page";
import { groupBySpace, words } from "@/lib/bookings/ui";
import { formatTimeRange } from "@/lib/format/datetime";
import { MakerspacePageHeader } from "@/components/dashboard/makerspace/MakerspacePageHeader";
import { AttendanceActions } from "@/components/bookings/AttendanceActions";
import { CheckInCodeForm } from "@/components/bookings/CheckInCodeForm";
import { Card, CardHeader, Chip, EmptyState } from "@/components/ui/display";

export const metadata = { title: "Today" };
export default async function Page(props: Parameters<typeof loadToday>[0]) {
  const { makerspace, date, canManage, spaces, rows } = await loadToday(props);
  const groups = groupBySpace(rows);
  return <div className="flex flex-col gap-6"><MakerspacePageHeader makerspace={makerspace} title="Today" description={`${date} · ${makerspace.timezone}`} />
    {canManage ? <CheckInCodeForm slug={makerspace.slug} /> : null}
    {!rows.length ? <EmptyState title="No bookings today">Confirmed bookings and requests appear here, grouped by space.</EmptyState> : spaces.filter((space) => groups[space.id]?.length).map((space) => <Card key={space.id}>
      <CardHeader title={space.name} />{groups[space.id].map((row, index, occurrences) => <div key={row.id} className="flex flex-wrap items-center gap-4 border-b border-line py-4 last:border-0">
        <div className="min-w-0 flex-1 text-ink"><Link className="font-semibold text-accent-text hover:underline" href={`/dashboard/${makerspace.slug}/bookings/${row.bookingId}`}>{row.booking.reference}</Link>
          <p>{formatTimeRange(row.startsAt, row.endsAt, makerspace.timezone)} · Unit {row.unit + 1}</p>
          <p>{row.booking.contactName ? `${row.booking.contactName} · ` : ""}{row.booking.attendees} attendees</p></div>
        <Chip>{row.noShowAt ? "No-show" : words(row.status)}</Chip><Chip>{words(row.booking.status)}</Chip>
        {canManage && occurrences.findIndex((item) => item.bookingId === row.bookingId && item.slotIndex === row.slotIndex) === index && (row.canCheckIn || row.canNoShow) ? <AttendanceActions slug={makerspace.slug} occurrenceId={row.id} noShow={Boolean(row.noShowAt)} canCheckIn={row.canCheckIn} canNoShow={row.canNoShow} /> : null}
      </div>)}
    </Card>)}
  </div>;
}
