import Link from "next/link";
import { loadAccountBookingsPage } from "@/lib/views/app__account__bookings__page";
import { Card, SectionHeading } from "@/components/ui/display";
import { PersonalCalendarCard } from "@/components/bookings/PersonalCalendarCard";
import { formatDate, formatTime } from "@/lib/format/datetime";
import { money } from "@/lib/money/currencies";
import { words } from "@/lib/bookings/ui";

export const metadata = { title: "Your bookings" };
export default async function AccountBookingsPage() {
  const { bookings, makerspaces } = await loadAccountBookingsPage();
  return <div className="flex flex-col gap-6"><SectionHeading title="Your bookings" description="Bookings made with your account across makerspaces." />
    {bookings.length ? <ul className="flex flex-col gap-4">{bookings.map((booking) => <li key={booking.id}><Card>
      <h2 className="text-h3"><Link href={`/m/${booking.makerspace.slug}/bookings/${booking.reference}`} className="underline underline-offset-4">{booking.spaceName} · {booking.reference}</Link></h2>
      <p>{booking.makerspace.name}{booking.startsAt ? ` · ${formatDate(booking.startsAt, booking.makerspace.timezone)}, ${formatTime(booking.startsAt, booking.makerspace.timezone)}` : ""}</p>
      <p>{words(booking.status)} · {money(booking.totalMinor, booking.currency)} · {booking.paymentLabel}</p>
    </Card></li>)}</ul> : <Card><h2 className="text-h3">No bookings yet</h2><p className="mt-2">Your bookings will appear here when you book while signed in. For a guest booking, use the private link in your email.</p></Card>}
    <PersonalCalendarCard makerspaces={makerspaces} />
  </div>;
}
