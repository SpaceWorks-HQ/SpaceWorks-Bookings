import Link from "next/link";
import { loadBookings } from "@/lib/views/app__dashboard__makerspaceSlug__bookings__page";
import { BOOKING_STATUSES, words } from "@/lib/bookings/ui";
import { formatDayTime } from "@/lib/format/datetime";
import { MakerspacePageHeader } from "@/components/dashboard/makerspace/MakerspacePageHeader";
import { Button } from "@/components/ui/button";
import { Card, Chip, EmptyState } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/field";
import { SelectField } from "@/components/bookings/FormFields";
import { CalendarFeedCard } from "@/components/bookings/CalendarFeedCard";
import { Pagination } from "@/components/bookings/Pagination";

export const metadata = { title: "Bookings" };
export default async function Page(props: Parameters<typeof loadBookings>[0]) {
  const data = await loadBookings(props);
  const { makerspace, rows } = data;
  const base = `/dashboard/${makerspace.slug}/bookings`;
  return <div className="flex flex-col gap-6"><MakerspacePageHeader makerspace={makerspace} title="Bookings" description={`Bookings and requests. Dates use ${makerspace.timezone}.`}
    actions={data.canManage ? <Button asChild><Link href={`${base}/new`}>Create booking</Link></Button> : undefined} />
    <Card><form className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label={data.contact ? "Reference, customer name or email" : "Booking reference"}><Input name="q" type="search" defaultValue={data.q} /></Field>
      <SelectField name="status" label="Status" value={data.status} options={[{ value: "", label: "All statuses" }, ...BOOKING_STATUSES]} />
      <SelectField name="space" label="Space" value={data.space} options={[{ value: "", label: "All spaces" }, ...data.spaces.map((row) => ({ value: row.id, label: row.name }))]} />
      <Field label="From local date"><Input type="date" name="from" defaultValue={data.from} /></Field><Field label="Through local date"><Input type="date" name="to" defaultValue={data.to} /></Field>
      <div><Button type="submit" variant="secondary">Filter bookings</Button></div>
    </form></Card>
    {!rows.length ? <EmptyState title="No matching bookings">Choose other filters or create a booking for a customer.</EmptyState> : <Card>{rows.map((row) => <div key={row.id} className="flex flex-wrap items-center gap-4 border-b border-line py-4 last:border-0">
      <div className="min-w-0 flex-1"><Link href={`${base}/${row.id}`} className="font-semibold text-accent-text underline-offset-4 hover:underline">{row.reference}</Link>
        <p className="text-ink">{row.spaceName}{row.name ? ` · ${row.name}` : ""}</p>{row.email ? <p className="text-ink-secondary">{row.email}</p> : null}
        <p className="text-ink-muted">{row.startsAt ? formatDayTime(row.startsAt, makerspace.timezone) : "No occurrences"}</p></div>
      <Chip>{words(row.status)}</Chip><Chip>{row.paymentLabel}</Chip>
    </div>)}</Card>}
    <Pagination page={data.page} pages={data.pages} query={{ q: data.q, status: data.status, space: data.space, from: data.from, to: data.to }} />
    <CalendarFeedCard slug={makerspace.slug} feed={data.feed} />
  </div>;
}
