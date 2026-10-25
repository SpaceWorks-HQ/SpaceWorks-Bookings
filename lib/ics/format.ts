/**
 * iCalendar (RFC 5545) writing. Pure and client-safe. Lines end in CRLF, are folded at 75 octets (never inside a
 * UTF-8 character) and text values are escaped. Times are UTC (`Z`), so no VTIMEZONE is needed.
 */

export type IcsPerson = { name?: string | null; email: string };
export type IcsStatus = "CONFIRMED" | "TENTATIVE" | "CANCELLED";
export type IcsEvent = {
  uid: string;
  sequence: number;
  dtstamp: Date;
  start: Date;
  end: Date;
  summary: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  status: IcsStatus;
  organizer?: IcsPerson | null;
  attendees?: IcsPerson[];
  lastModified?: Date | null;
};
export type IcsMethod = "PUBLISH" | "REQUEST" | "CANCEL";
export type IcsCalendar = { prodId?: string; method?: IcsMethod | null; name?: string | null; events: IcsEvent[] };

export const PRODID = "-//Space Works//Bookings//EN";

/** Escape a TEXT value: backslash, semicolon, comma and newlines. */
export function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/** A parameter value (CN): quoted, with characters a quoted value can't hold removed. */
function paramValue(value: string): string {
  return `"${value.replace(/["\r\n]/g, "").replace(/[\u0000-\u001f\u007f]/g, "")}"`;
}

/** 20261102T043000Z */
export function formatIcsDateTime(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Fold a content line at 75 octets: continuation lines start with one space. */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function person(property: "ORGANIZER" | "ATTENDEE", value: IcsPerson, extra = ""): string {
  const name = value.name?.trim() ? `;CN=${paramValue(value.name.trim())}` : "";
  return `${property}${name}${extra}:mailto:${value.email.replace(/[\s:;,]/g, "")}`;
}

function eventLines(event: IcsEvent): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `SEQUENCE:${event.sequence}`,
    `DTSTAMP:${formatIcsDateTime(event.dtstamp)}`,
    `DTSTART:${formatIcsDateTime(event.start)}`,
    `DTEND:${formatIcsDateTime(event.end)}`,
    `SUMMARY:${escapeIcsText(event.summary)}`,
    `STATUS:${event.status}`,
  ];
  if (event.lastModified) lines.push(`LAST-MODIFIED:${formatIcsDateTime(event.lastModified)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  if (event.url) lines.push(`URL:${event.url}`);
  if (event.organizer) lines.push(person("ORGANIZER", event.organizer));
  for (const attendee of event.attendees ?? []) lines.push(person("ATTENDEE", attendee, ";ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED"));
  lines.push("TRANSP:OPAQUE", "END:VEVENT");
  return lines;
}

/** A whole VCALENDAR as a string ending in CRLF. */
export function buildIcs(calendar: IcsCalendar): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${calendar.prodId ?? PRODID}`, "CALSCALE:GREGORIAN"];
  if (calendar.method) lines.push(`METHOD:${calendar.method}`);
  if (calendar.name) lines.push(`X-WR-CALNAME:${escapeIcsText(calendar.name)}`);
  for (const event of calendar.events) lines.push(...eventLines(event));
  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}
