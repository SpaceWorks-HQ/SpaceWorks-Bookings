import { invalidInput } from "@/lib/bookings/errors";
import { parseDateKey, startOfLocalDay } from "@/lib/time/zoned";

/** A date input is a makerspace calendar day; explicit timestamp inputs retain their instant. */
export function resolveFinancialDate(value: string | Date, timezone: string): Date {
  if (value instanceof Date) return value;
  const date = parseDateKey(value);
  if (!date) throw invalidInput("Choose a valid date.");
  return startOfLocalDay(date, timezone);
}
