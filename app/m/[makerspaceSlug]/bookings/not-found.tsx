"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Card } from "@/components/ui/display";
import { buttonClasses } from "@/components/ui/button";

/** Unknown references and failed ownership checks share the same recovery page. */
export default function BookingNotFound() {
  const { makerspaceSlug } = useParams<{ makerspaceSlug: string }>();
  return <div className="mx-auto max-w-2xl px-4 py-12"><Card><h1 className="text-h1">Open your booking</h1><p className="my-4">We couldn&apos;t open this booking. Use the private link in your booking email, or sign in to the account that made the booking.</p>
    <div className="flex flex-wrap gap-3"><Link href={`/m/${encodeURIComponent(makerspaceSlug)}/bookings/find`} className={buttonClasses({ variant: "primary" })}>Email me a booking link</Link><Link href="/account/bookings" className={buttonClasses()}>Your bookings</Link></div></Card></div>;
}
