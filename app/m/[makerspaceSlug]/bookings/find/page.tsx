import { loadFindBookingPage } from "@/lib/views/app__m__makerspaceSlug__bookings__find__page";
import { FindBookingForm } from "@/components/bookings/FindBookingForm";
import { Card } from "@/components/ui/display";

export const metadata = { title: "Find your booking", robots: { index: false, follow: false } };
export default async function FindBookingPage({ params }: { params: Promise<{ makerspaceSlug: string }> }) {
  const { makerspace } = await loadFindBookingPage({ params });
  return <div className="mx-auto max-w-xl px-4 py-12"><Card><h1 className="mb-4 text-h1">Find your booking</h1><p className="mb-6">Enter the email you used to book at {makerspace.name}. New links replace any older private links.</p><FindBookingForm slug={makerspace.slug} /></Card></div>;
}
