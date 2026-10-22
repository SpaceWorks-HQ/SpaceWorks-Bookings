import { redirect } from "next/navigation";

/** The account home is the profile until bookings arrive (Phase 1 adds "Your bookings" here). */
export default function AccountPage() {
  redirect("/account/profile");
}
