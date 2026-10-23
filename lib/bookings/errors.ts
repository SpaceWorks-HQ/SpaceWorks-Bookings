import { Prisma } from "@prisma/client";
import type { Violation } from "@/lib/availability/validate";

/**
 * Typed errors for the booking domain. Callers (server actions, the API) map `code` to a response; `message` is
 * en-GB copy safe to show. Anything of another makerspace is NOT_FOUND, never FORBIDDEN.
 */

export type BookingErrorCode =
  | "HOLD_GONE"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_STATE"
  | "INVALID_INPUT"
  | "SLOT_TAKEN"
  | "UNAVAILABLE"
  | "CUTOFF_PASSED"
  | "NO_RATE"
  | "OVERRIDE_REASON_REQUIRED";

export const SLOT_TAKEN_MESSAGE = "That time was just taken.";

export class BookingError extends Error {
  override name = "BookingError";
  constructor(
    readonly code: BookingErrorCode,
    message: string,
    /** Per-slot problems for UNAVAILABLE: which slot and why. */
    readonly conflicts: SlotConflict[] = [],
    /** Per-field problems for INVALID_INPUT, keyed by field name. */
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

export type SlotConflict = { slotIndex: number; start: Date; end: Date; violations: Violation[] };

export const notFound = (what = "Booking") => new BookingError("NOT_FOUND", `${what} not found.`);
export const forbidden = (message = "You can't do that.") => new BookingError("FORBIDDEN", message);
export const invalidState = (message: string) => new BookingError("INVALID_STATE", message);
export const holdGone = (message = "Your hold is no longer available. Choose a time again.") => new BookingError("HOLD_GONE", message);
export const invalidInput = (message: string, fields: Record<string, string> = {}) => new BookingError("INVALID_INPUT", message, [], fields);

/** A zod failure as INVALID_INPUT with per-field messages. */
export function zodInputError(issues: Array<{ path: PropertyKey[]; message: string }>): BookingError {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".") || "input";
    fields[key] ??= issue.message;
  }
  return invalidInput("Check the highlighted fields.", fields);
}

/** Postgres 23P01 from the occurrence exclusion constraint, however Prisma wrapped it. */
export function isExclusionViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = error.meta as Record<string, unknown> | undefined;
    if (meta?.code === "23P01" || String(meta?.message ?? "").includes("BookingOccurrence_no_overlap")) return true;
  }
  const text = error instanceof Error ? error.message : String(error);
  return text.includes("23P01") || text.includes("BookingOccurrence_no_overlap") || text.includes("conflicting key value violates exclusion constraint");
}

/** Run a booking write; an exclusion violation becomes SLOT_TAKEN. */
export async function mapSlotTaken<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isExclusionViolation(error)) throw new BookingError("SLOT_TAKEN", SLOT_TAKEN_MESSAGE);
    throw error;
  }
}
