import { redirect } from "next/navigation";

/** The account home opens the customer's bookings. */
export default function AccountPage() {
  redirect("/account/bookings");
}
