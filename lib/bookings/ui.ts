import { addLocalDays, dateKey, localParts, parseDateKey, resolveLocal, startOfLocalDay } from "@/lib/time/zoned";

export const BOOKING_STATUSES = ["HELD", "REQUESTED", "CONFIRMED", "DECLINED", "CANCELLED", "EXPIRED"] as const;
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const words = (value: string) => { const text = value.replace(/_/g, " ").toLowerCase(); return text.charAt(0).toUpperCase() + text.slice(1); };

export function minuteText(minute: number) {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export function parseMinute(value: string, closing = false) {
  if (!/^\d{2}:\d{2}$/.test(value)) throw new Error("Use HH:MM for opening and closing times.");
  const [hour, minute] = value.split(":").map(Number);
  if (minute > 59 || hour > 24 || (hour === 24 && (!closing || minute !== 0))) throw new Error("Only closing times may use 24:00.");
  return hour * 60 + minute;
}

export function localInputToIso(value: string, zone: string, closing = false) {
  const [day, time] = value.split("T");
  const date = parseDateKey(day);
  if (!date || !time) throw new Error("Choose a date and time.");
  const resolved = resolveLocal(date, parseMinute(time, closing), zone, closing ? "last" : "first");
  if (resolved.kind === "nonexistent") throw new Error("That local time does not exist because the clocks change. Choose another time.");
  return resolved.instant.toISOString();
}

export function instantToLocalInput(value: string, zone: string) {
  const parts = localParts(new Date(value), zone);
  return `${dateKey(parts.date)}T${minuteText(parts.minute)}`;
}

export function localDayRange(value: string, zone: string) {
  const date = parseDateKey(value);
  if (!date) return null;
  return { start: startOfLocalDay(date, zone), end: startOfLocalDay(addLocalDays(date, 1), zone) };
}

export function groupBySpace<T extends { spaceId: string }>(rows: T[]) {
  return rows.reduce<Record<string, T[]>>((groups, row) => { (groups[row.spaceId] ??= []).push(row); return groups; }, {});
}

export function snapshotLines(value: unknown): Array<{ description: string; detail: string; totalMinor: number }> {
  if (!value || typeof value !== "object" || !("lines" in value) || !Array.isArray(value.lines)) return [];
  return value.lines.flatMap((line: unknown) => {
    if (!line || typeof line !== "object" || !("description" in line) || !("amountMinor" in line)) return [];
    return typeof line.description === "string" && typeof line.amountMinor === "number"
      ? [{ description: line.description, detail: "detail" in line && typeof line.detail === "string" ? line.detail : "", totalMinor: line.amountMinor }] : [];
  });
}

export function eventReason(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  for (const key of ["reason", "overrideReason"] as const) {
    if (key in value && typeof (value as Record<string, unknown>)[key] === "string") return (value as Record<string, string>)[key];
  }
  return null;
}
