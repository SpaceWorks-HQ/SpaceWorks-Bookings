import Link from "next/link";
import { loadAccountBookingsPage } from "@/lib/views/app__account__bookings__page";
import { Card, Chip, EmptyState, SectionHeading } from "@/components/ui/display";
import { buttonClasses } from "@/components/ui/button";
import { PersonalCalendarCard } from "@/components/bookings/PersonalCalendarCard";
import { formatDate, formatTime } from "@/lib/format/datetime";
import { money } from "@/lib/money/currencies";
import { words } from "@/lib/bookings/ui";

export const metadata = { title: "Your bookings" };
export default async function AccountBookingsPage() {
  const { bookings, makerspaces } = await loadAccountBookingsPage();
  return <div className="flex flex-col gap-6"><SectionHeading title="Your bookings" description="Bookings made with your account across makerspaces." />
    {bookings.length ? <ul className="flex flex-col gap-4">{bookings.map((booking) => <li key={booking.id}><Card className="relative flex flex-col gap-2 transition-colors duration-[120ms] ease-sw hover:border-line-strong">
      <h2 className="text-h3"><Link href={`/m/${booking.makerspace.slug}/bookings/${booking.reference}`} className="underline-offset-4 after:absolute after:inset-0 after:rounded-xl after:content-[''] hover:underline">{booking.spaceName} · {booking.reference}</Link></h2>
      <p className="text-ink-secondary">{booking.makerspace.name}{booking.startsAt ? ` · ${formatDate(booking.startsAt, booking.makerspace.timezone)}, ${formatTime(booking.startsAt, booking.makerspace.timezone)}` : ""}</p>
      <div className="flex flex-wrap items-center gap-2"><Chip>{words(booking.status)}</Chip><Chip>{booking.paymentLabel}</Chip><span className="tabular-nums text-ink">{money(booking.totalMinor, booking.currency)}</span></div>
    </Card></li>)}</ul> : <EmptyState mood="sleepy" title="No bookings yet" action={<Link href="/makerspaces" className={buttonClasses({ variant: "secondary" })}>Find a makerspace</Link>}>Bookings you make while signed in appear here. For a guest booking, use the private link in your email.</EmptyState>}
    <PersonalCalendarCard makerspaces={makerspaces} />
  </div>;
}
