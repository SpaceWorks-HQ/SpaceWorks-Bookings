import { loadNewBooking } from "@/lib/views/app__dashboard__makerspaceSlug__bookings__new__page";
import { MakerspacePageHeader } from "@/components/dashboard/makerspace/MakerspacePageHeader";
import { StaffBookingForm } from "@/components/bookings/StaffBookingForm";

export const metadata = { title: "Create booking" };
export default async function Page(props: Parameters<typeof loadNewBooking>[0]) {
  const { makerspace, ...data } = await loadNewBooking(props);
  return <div className="flex flex-col gap-6"><MakerspacePageHeader makerspace={makerspace} title="Create booking" description="Book a space on behalf of a customer." />
    <StaffBookingForm slug={makerspace.slug} timezone={makerspace.timezone} currency={makerspace.currency} {...data} />
  </div>;
}
