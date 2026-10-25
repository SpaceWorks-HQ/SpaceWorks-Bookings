import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STAMP_MINUTES, everyoneArrived, showBookedStamp } from "@/lib/bookings/eggs";

const now = new Date("2030-01-07T10:00:00Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

describe("booking easter eggs", () => {
  it("stamps a booking only while it is freshly confirmed", () => {
    expect(showBookedStamp({ status: "CONFIRMED", confirmedAt: minutesAgo(1) }, now)).toBe(true);
    expect(showBookedStamp({ status: "CONFIRMED", confirmedAt: minutesAgo(STAMP_MINUTES + 1) }, now)).toBe(false);
    expect(showBookedStamp({ status: "REQUESTED", confirmedAt: minutesAgo(1) }, now)).toBe(false);
    expect(showBookedStamp({ status: "CONFIRMED", confirmedAt: null }, now)).toBe(false);
    expect(showBookedStamp({ status: "CONFIRMED", confirmedAt: new Date(now.getTime() + 60_000) }, now)).toBe(false);
  });

  it("celebrates only when every confirmed arrival due today has checked in", () => {
    const row = (status: string, noShowAt: Date | null = null, booking = "CONFIRMED") => ({ status, noShowAt, booking: { status: booking } });
    expect(everyoneArrived([])).toBe(false);
    expect(everyoneArrived([row("CHECKED_IN"), row("COMPLETED")])).toBe(true);
    expect(everyoneArrived([row("CHECKED_IN"), row("SCHEDULED")])).toBe(false);
    expect(everyoneArrived([row("CHECKED_IN"), row("SCHEDULED", now)])).toBe(false);
    expect(everyoneArrived([row("CHECKED_IN"), row("SCHEDULED", null, "REQUESTED")])).toBe(true);
  });

  it("keeps the eggs decorative and still under reduced motion", () => {
    const component = readFileSync(path.join(process.cwd(), "components/eggs/BookingEggs.tsx"), "utf8");
    expect(component.match(/aria-hidden/g)?.length).toBeGreaterThanOrEqual(3);
    expect(component).not.toMatch(/<Patch[^>]*\/>[^]*BookedStamp/);
    const css = readFileSync(path.join(process.cwd(), "app/styles/eggs.css"), "utf8");
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[^}]*\.sw-stamp \{ animation: none; \}/);
    // The stamp sits on a makerspace-branded page: it never brings Patch along.
    const manage = readFileSync(path.join(process.cwd(), "app/m/[makerspaceSlug]/bookings/[reference]/page.tsx"), "utf8");
    expect(manage).not.toMatch(/Patch|NappingPatch|AllHerePatch/);
  });
});
