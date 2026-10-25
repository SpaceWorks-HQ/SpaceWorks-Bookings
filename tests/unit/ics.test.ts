import { describe, expect, it } from "vitest";
import { bookingInvite, icsStatus, occurrenceUid, slotRows, type IcsContext, type IcsOccurrence } from "@/lib/ics/booking";
import { buildIcs, escapeIcsText, foldIcsLine, formatIcsDateTime } from "@/lib/ics/format";

const unfold = (text: string) => text.replace(/\r\n /g, "");

describe("ICS formatting", () => {
  it("escapes text values", () => {
    expect(escapeIcsText("a\\b;c,d\ne\r\nf")).toBe("a\\\\b\\;c\\,d\\ne\\nf");
  });

  it("writes UTC basic date-times", () => {
    expect(formatIcsDateTime(new Date("2026-11-02T04:30:00.123Z"))).toBe("20261102T043000Z");
  });

  it("folds lines at 75 octets without splitting a character", () => {
    const line = `SUMMARY:${"₹".repeat(60)}`;
    const folded = foldIcsLine(line);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    for (const [index, part] of parts.entries()) {
      expect(Buffer.byteLength(part, "utf8")).toBeLessThanOrEqual(75);
      if (index > 0) expect(part.startsWith(" ")).toBe(true);
    }
    expect(unfold(folded)).toBe(line);
    expect(foldIcsLine("SHORT:1")).toBe("SHORT:1");
  });

  it("builds a calendar with CRLF endings and a method", () => {
    const text = buildIcs({ method: "REQUEST", events: [{ uid: "u1@x", sequence: 2, dtstamp: new Date(0), start: new Date(0), end: new Date(3_600_000), summary: "Room, test", status: "CONFIRMED", organizer: { name: 'Tinker "space"', email: "hello@demo.test" }, attendees: [{ name: "Asha", email: "asha@demo.test" }] }] });
    expect(text.endsWith("\r\n")).toBe(true);
    expect(text.split("\r\n").every((line) => !line.includes("\n"))).toBe(true);
    const lines = unfold(text).split("\r\n");
    expect(lines).toContain("METHOD:REQUEST");
    expect(lines).toContain("SEQUENCE:2");
    expect(lines).toContain("SUMMARY:Room\\, test");
    expect(lines).toContain('ORGANIZER;CN="Tinker space":mailto:hello@demo.test');
    expect(lines).toContain('ATTENDEE;CN="Asha";ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:asha@demo.test');
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines.filter(Boolean).at(-1)).toBe("END:VCALENDAR");
  });
});

describe("booking invites", () => {
  const context: IcsContext = {
    booking: { reference: "BK-7Q2M9X", status: "CONFIRMED", contactName: "Asha Menon", contactEmail: "asha@demo.test" },
    spaceName: "Studio A",
    makerspace: { name: "Tinkerspace", contactEmail: "hello@demo.test", address: "Alappuzha" },
    manageUrl: "https://bookings.demo.test/m/tinkerspace/booking/abc",
    now: new Date("2026-11-01T00:00:00Z"),
  };
  const row = (id: string, slotIndex: number, unit: number, day: number, over: Partial<IcsOccurrence> = {}): IcsOccurrence => ({ id, slotIndex, unit, startsAt: new Date(Date.UTC(2026, 10, day, 4, 30)), endsAt: new Date(Date.UTC(2026, 10, day, 6, 30)), status: "SCHEDULED", sequence: 0, updatedAt: new Date(0), ...over });

  it("makes one event per slot, with a stable UID from its first unit", () => {
    const rows = [row("b", 0, 1, 2), row("a", 0, 0, 2), row("c", 1, 0, 9)];
    expect(slotRows(rows).map((item) => item.id)).toEqual(["a", "c"]);
    const text = unfold(bookingInvite(context, rows, "REQUEST"));
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(text).toContain(`UID:${occurrenceUid("a")}`);
    expect(text).toContain(`UID:${occurrenceUid("c")}`);
    expect(text).toContain("STATUS:CONFIRMED");
    expect(text).toContain("DTSTART:20261102T043000Z");
    expect(text).toContain("URL:https://bookings.demo.test/m/tinkerspace/booking/abc");
  });

  it("cancels with METHOD:CANCEL, the same UID and the bumped sequence", () => {
    const text = unfold(bookingInvite(context, [row("a", 0, 0, 2, { status: "CANCELLED", sequence: 3 })], "CANCEL"));
    expect(text).toContain("METHOD:CANCEL");
    expect(text).toContain(`UID:${occurrenceUid("a")}`);
    expect(text).toContain("SEQUENCE:3");
    expect(text).toContain("STATUS:CANCELLED");
  });

  it("marks requests tentative and ended bookings cancelled", () => {
    expect(icsStatus("REQUESTED", "SCHEDULED")).toBe("TENTATIVE");
    expect(icsStatus("CONFIRMED", "CHECKED_IN")).toBe("CONFIRMED");
    expect(icsStatus("DECLINED", "SCHEDULED")).toBe("CANCELLED");
    expect(icsStatus("CONFIRMED", "CANCELLED")).toBe("CANCELLED");
  });
});
