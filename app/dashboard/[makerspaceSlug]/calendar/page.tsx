import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import { loadCalendar } from "@/lib/views/app__dashboard__makerspaceSlug__calendar__page";
import { MakerspacePageHeader } from "@/components/dashboard/makerspace/MakerspacePageHeader";
import { Card, EmptyState } from "@/components/ui/display";
import { NavTabs } from "@/components/ui/tabs";
import { buttonClasses } from "@/components/ui/button";
import { Field, Dropdown } from "@/components/ui/field";
import { formatTimeRange } from "@/lib/format/datetime";
import { words } from "@/lib/bookings/ui";
import { cn } from "@/lib/cn";
import { NappingPatch } from "@/components/eggs/BookingEggs";

export const metadata: Metadata = { title: "Calendar", robots: { index: false, follow: false } };

const dayLabel = (day: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

export default async function CalendarPage(props: Parameters<typeof loadCalendar>[0]) {
  const view = await loadCalendar(props);
  const base = `/dashboard/${view.makerspace.slug}`;
  const link = (params: Record<string, string>) => `${base}/calendar?${new URLSearchParams({ view: view.view, date: view.days[0], ...(view.spaceFilter ? { space: view.spaceFilter } : {}), ...params })}`;
  const zone = view.makerspace.timezone;
  return <div className="flex flex-col gap-6">
    <MakerspacePageHeader makerspace={view.makerspace} title="Calendar" description={`${dayLabel(view.days[0])}${view.days.length > 1 ? ` to ${dayLabel(view.days.at(-1)!)}` : ""} · ${zone}`}
      actions={<div className="flex flex-wrap gap-3">
        <Link className={buttonClasses({ variant: "secondary" })} href={link({ date: view.previous })} aria-label={`Previous ${view.view}`}><ChevronLeft aria-hidden className="size-[18px]" />Previous</Link>
        <Link className={buttonClasses({ variant: "secondary" })} href={link({ date: view.today })}>Today</Link>
        <Link className={buttonClasses({ variant: "secondary" })} href={link({ date: view.next })} aria-label={`Next ${view.view}`}>Next<ChevronRight aria-hidden className="size-[18px]" /></Link>
      </div>} />
    <div className="flex flex-wrap items-end justify-between gap-4">
      <NavTabs label="Calendar view" items={[{ href: link({ view: "day" }), label: "Day", active: view.view === "day" }, { href: link({ view: "week" }), label: "Week", active: view.view === "week" }]} />
      <form method="get" className="flex items-end gap-3"><input type="hidden" name="view" value={view.view} /><input type="hidden" name="date" value={view.days[0]} />
        <Field label="Space"><Dropdown name="space" defaultValue={view.spaceFilter}><option value="">All spaces</option>{view.allSpaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</Dropdown></Field>
        <button type="submit" className={buttonClasses({ variant: "secondary" })}>Filter</button>
      </form>
    </div>
    {view.empty ? <EmptyState icon={<NappingPatch />} title="Nothing booked">No bookings in this {view.view === "day" ? "day" : "week"}.</EmptyState> : null}
    <Card padding="none" className="overflow-x-auto">
      <table className={cn("w-full table-fixed border-collapse text-left", view.days.length > 1 ? "min-w-[900px]" : "min-w-[480px]")}>
        <thead><tr className="border-b border-line"><th className="sticky left-0 z-[1] w-36 bg-panel px-4 py-3 text-ink-muted">Space</th>
          {view.days.map((day) => <th key={day} scope="col" className={cn("px-3 py-3 font-semibold text-ink", day === view.today && "text-accent-text")} aria-current={day === view.today ? "date" : undefined}>{dayLabel(day)}</th>)}</tr></thead>
        <tbody>{view.rows.map((space) => <tr key={space.id} className="border-b border-line align-top">
          <th scope="row" className="sticky left-0 z-[1] break-words bg-panel px-4 py-3 font-semibold text-ink">{space.name}{space.units > 1 ? <span className="block text-ink-muted">{space.units} units</span> : null}</th>
          {space.cells.map((cell) => <td key={cell.day} className={cn("px-2 py-2", cell.day === view.today && "bg-surface")}>
            <ul className="flex flex-col gap-2">{cell.items.map((item) => <li key={item.id}>
              <Link href={`${base}/bookings/${item.booking.id}`} title={[formatTimeRange(item.startsAt, item.endsAt, zone), item.booking.reference, item.booking.name].filter(Boolean).join(" · ")} className="block min-h-11 rounded-md border border-line bg-panel px-2 py-1.5 text-ink hover:border-ink">
                <span className="block font-semibold tabular-nums">{formatTimeRange(item.startsAt, item.endsAt, zone)}</span>
                <span className="block truncate text-ink-secondary">{item.booking.reference} · {words(item.booking.status === "CONFIRMED" ? item.status : item.booking.status)}</span>
                {item.booking.name ? <span className="block truncate text-ink-muted">{item.booking.name} · {item.booking.attendees}</span> : null}
              </Link>
            </li>)}</ul>
          </td>)}
        </tr>)}</tbody>
      </table>
    </Card>
  </div>;
}
