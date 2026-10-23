import type { TeamRole } from "@prisma/client";
import { can, type Capability } from "@/lib/permissionRoles";
import { forbidden } from "./errors";

/**
 * Who is acting. Server actions resolve this (session, team role, manage token) and pass it in; the services check
 * what only they can know (ownership, `bookings.override`, money keys). A customer without `userId` is a guest who
 * proves ownership with the manage token.
 */
export type CustomerActor = { kind: "CUSTOMER"; userId: string | null; manageToken?: string | null };
export type StaffActor = { kind: "STAFF"; userId: string; role: TeamRole };
export type SystemActor = { kind: "SYSTEM" };
export type ApiActor = { kind: "API"; keyId: string };
export type Actor = CustomerActor | StaffActor | SystemActor | ApiActor;

export const SYSTEM: SystemActor = { kind: "SYSTEM" };

export function actorUserId(actor: Actor): string | null {
  return actor.kind === "STAFF" || actor.kind === "CUSTOMER" ? actor.userId : null;
}

export function isStaff(actor: Actor): actor is StaffActor {
  return actor.kind === "STAFF";
}

export function staffCan(actor: Actor, capability: Capability): boolean {
  return actor.kind === "STAFF" && can(actor.role, capability);
}

/** Staff with the capability; anyone else is refused. */
export function requireStaff(actor: Actor, capability: Capability): StaffActor {
  if (actor.kind !== "STAFF" || !can(actor.role, capability)) throw forbidden();
  return actor;
}

/** Staff with the capability, or the system (jobs). */
export function requireStaffOrSystem(actor: Actor, capability: Capability): void {
  if (actor.kind === "SYSTEM") return;
  requireStaff(actor, capability);
}
