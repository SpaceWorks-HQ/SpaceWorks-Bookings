import { manageTokenMatches } from "@/lib/bookings/tokens";

/** Shared by the private manage view and calendar download; tenant and reference must also match. */
export function canReadBooking(booking: { makerspaceId: string; reference: string; customerUserId: string | null; manageTokenHash: string } | null,
  input: { makerspaceId: string; reference: string; userId?: string | null; token?: string | null }) {
  return Boolean(booking && booking.makerspaceId === input.makerspaceId && booking.reference === input.reference &&
    ((input.userId && booking.customerUserId === input.userId) || manageTokenMatches(input.token, booking.manageTokenHash)));
}
