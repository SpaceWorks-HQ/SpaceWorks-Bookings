import { z } from "zod";
import { revalidatePath as nextRevalidatePath } from "next/cache";
import { trackedRevalidation } from "@/lib/frontend/revalidation";
import { makerspaceActionAccess } from "@/lib/permissions";
import type { Capability } from "@/lib/permissionRoles";
import { requireStaff, type StaffActor } from "@/lib/bookings/actor";
import { BookingError, isExclusionViolation, SLOT_TAKEN_MESSAGE } from "@/lib/bookings/errors";
import type { ActionResult } from "@/app/actions/makerspace";

const revalidatePath = trackedRevalidation(nextRevalidatePath);
export type StaffContext = { makerspaceId: string; actor: StaffActor };

export function inputFailure(error: z.ZodError): ActionResult<never> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) (fieldErrors[String(issue.path[0] ?? "input")] ??= []).push(issue.message);
  return { ok: false, error: "Check the highlighted fields.", fieldErrors };
}

export function bookingFailure(error: unknown): ActionResult<never> {
  if (isExclusionViolation(error) || (error instanceof BookingError && error.code === "SLOT_TAKEN")) {
    return { ok: false, error: SLOT_TAKEN_MESSAGE };
  }
  if (error instanceof BookingError) {
    const taken = error.conflicts.some((conflict) => conflict.violations.some((item) => item.code === "UNAVAILABLE"));
    return {
      ok: false,
      error: taken ? SLOT_TAKEN_MESSAGE : error.message,
      ...(error.code === "HOLD_GONE" ? { code: error.code } : {}),
      ...(Object.keys(error.fields).length ? { fieldErrors: Object.fromEntries(Object.entries(error.fields).map(([key, value]) => [key, [value]])) } : {}),
    };
  }
  console.error("[bookings] action failed", error instanceof Error ? error.name : typeof error);
  return { ok: false, error: "Could not save your changes. Please try again." };
}

export function revalidateBookings(slug: string) {
  revalidatePath(`/dashboard/${slug}`, "layout");
  revalidatePath(`/m/${slug}`, "layout");
  revalidatePath("/account", "layout");
}

/** Parse before access; only server-resolved tenant and actor values reach services. */
export async function staffAction<S extends z.ZodType<{ makerspaceSlug: string }>, T>(
  schema: S,
  input: unknown,
  capabilities: Capability | ((data: z.output<S>) => Capability[]),
  work: (data: z.output<S>, context: StaffContext) => Promise<T>,
): Promise<ActionResult<T>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return inputFailure(parsed.error);
  const data = parsed.data as z.output<S>;
  const needed = typeof capabilities === "function" ? capabilities(data) : [capabilities];
  try {
    const access = await makerspaceActionAccess(data.makerspaceSlug, needed[0]);
    if (!access.ok) return access;
    const actor: StaffActor = { kind: "STAFF", userId: access.userId, role: access.membership.role };
    for (const capability of needed.slice(1)) requireStaff(actor, capability);
    const result = await work(data, { makerspaceId: access.makerspace.id, actor });
    revalidateBookings(data.makerspaceSlug);
    return { ok: true, data: result };
  } catch (error) {
    return bookingFailure(error);
  }
}
