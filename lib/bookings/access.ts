import type { Booking } from "@prisma/client";
import type { Capability } from "@/lib/permissionRoles";
import { staffCan, type Actor } from "./actor";
import { forbidden } from "./errors";
import { manageTokenMatches } from "./tokens";

/** The customer who made a booking: their account, or whoever holds its manage token. */
export function isBookingOwner(booking: Pick<Booking, "customerUserId" | "manageTokenHash">, actor: Actor): boolean {
  if (actor.kind !== "CUSTOMER") return false;
  if (actor.userId && booking.customerUserId === actor.userId) return true;
  return manageTokenMatches(actor.manageToken, booking.manageTokenHash);
}

/** Owner, staff with the capability, the system or an API key (Phase 3 scopes it); anyone else is refused. */
export function assertCanActOn(booking: Pick<Booking, "customerUserId" | "manageTokenHash">, actor: Actor, capability: Capability): void {
  if (actor.kind === "SYSTEM" || actor.kind === "API") return;
  if (actor.kind === "STAFF" ? staffCan(actor, capability) : isBookingOwner(booking, actor)) return;
  throw forbidden();
}
