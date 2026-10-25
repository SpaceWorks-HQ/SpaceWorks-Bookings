import crypto from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const stats = await import("@/lib/reports/bookings/stats");
const { calendarDays, placeOnGrid, shiftDay } = await import("@/lib/bookings/calendarGrid");
const events = await import("@/lib/integrations/webhooks/events");
const { parseApiKey } = await import("@/lib/integrations/apiKeys");
const { API_PATHS, openApiDocument } = await import("@/lib/api/openapi");

const H = 3_600_000;
const t = (hours: number) => Date.UTC(2030, 0, 7) + hours * H;

describe("booking report maths", () => {
  const spaces = [{ id: "a", name: "Room", units: 2, open: [{ start: t(9), end: t(17) }] }, { id: "b", name: "Closed", units: 1, open: [] }];
  const rows = [
    { spaceId: "a", bookingId: "1", startsAt: t(8), endsAt: t(10), status: "COMPLETED" },
    { spaceId: "a", bookingId: "2", startsAt: t(12), endsAt: t(14), status: "NO_SHOW" },
    { spaceId: "a", bookingId: "3", startsAt: t(14), endsAt: t(16), status: "CANCELLED" },
  ];

  it("measures booked over open unit-minutes inside the window", () => {
    const result = stats.utilisation(spaces, rows, { start: t(9), end: t(17) });
    expect(result[0]).toMatchObject({ openMinutes: 960, bookedMinutes: 180, ratio: 180 / 960 });
    expect(result[1].ratio).toBeNull();
    expect(stats.overallUtilisation(result)).toBeCloseTo(180 / 960);
    expect(stats.overallUtilisation([])).toBeNull();
  });

  it("counts no-shows among visits that came due, and buckets bookings", () => {
    expect(stats.noShowRate(rows)).toEqual({ noShows: 1, attended: 1, rate: 0.5 });
    expect(stats.noShowRate([])).toEqual({ noShows: 0, attended: 0, rate: null });
    const bookings = [{ id: "1", status: "CONFIRMED", source: "PUBLIC", cancelKind: null, createdAt: t(1) }, { id: "2", status: "CANCELLED", source: "STAFF", cancelKind: "VENUE", createdAt: t(30) }];
    expect(stats.statusCounts(bookings)).toEqual({ CONFIRMED: 1, CANCELLED: 1 });
    expect(stats.bookingsPerBucket(bookings, [{ from: t(0), to: t(24) }, { from: t(24), to: t(48) }])).toEqual([1, 1]);
  });

  it("totals refunds and payments per reason or method, per currency", () => {
    expect(stats.refundsByKind([
      { kind: "POLICY", currency: "INR", amountMinor: 500, status: "PROCESSED" }, { kind: "POLICY", currency: "INR", amountMinor: 300, status: "PROCESSED" },
      { kind: "VENUE", currency: "USD", amountMinor: 900, status: "PROCESSED" }, { kind: "VENUE", currency: "INR", amountMinor: 50, status: "PENDING" },
    ])).toEqual([{ kind: "VENUE", currency: "USD", amountMinor: 900, count: 1 }, { kind: "POLICY", currency: "INR", amountMinor: 800, count: 2 }]);
    expect(stats.paymentMethods([{ provider: "RAZORPAY", method: "upi", currency: "INR", amountMinor: 100 }, { provider: "OFFLINE", method: null, currency: "INR", amountMinor: 50 }]))
      .toEqual([{ method: "upi", currency: "INR", amountMinor: 100, count: 1 }, { method: "offline", currency: "INR", amountMinor: 50, count: 1 }]);
  });
});

describe("calendar grid", () => {
  it("starts weeks on Monday and steps by the view", () => {
    expect(calendarDays("2030-01-09", "week")).toEqual(["2030-01-07", "2030-01-08", "2030-01-09", "2030-01-10", "2030-01-11", "2030-01-12", "2030-01-13"]);
    expect(calendarDays("2030-01-13", "week")[0]).toBe("2030-01-07");
    expect(calendarDays("2030-01-09", "day")).toEqual(["2030-01-09"]);
    expect(shiftDay("2030-01-07", "week", 1)).toBe("2030-01-14");
    expect(shiftDay("2030-01-07", "day", -1)).toBe("2030-01-06");
  });

  it("places an overnight booking on both local days", () => {
    const zone = "Asia/Kolkata";
    // 20:00 to 02:00 IST on 7–8 Jan.
    const item = { id: "x", spaceId: "s", startsAt: Date.UTC(2030, 0, 7, 14, 30), endsAt: Date.UTC(2030, 0, 7, 20, 30) };
    const grid = placeOnGrid([item], calendarDays("2030-01-07", "week"), zone);
    expect([...grid.keys()]).toEqual(["s|2030-01-07", "s|2030-01-08"]);
  });
});

describe("webhooks", () => {
  const booking = {
    id: "b1", reference: "BK-7Q2M9X", status: "CONFIRMED" as const, spaceId: "s1", quantity: 1, attendees: 3, currency: "INR",
    totalMinor: 1000, chargeMinor: 1000, paidMinor: 1000, refundedMinor: 0, paymentDueAt: null, writtenOffAt: null, space: { slug: "room" },
    occurrences: [{ id: "o1", startsAt: new Date(t(10)), endsAt: new Date(t(12)), status: "SCHEDULED" }],
    contactEmail: "asha@example.test", contactName: "Asha",
  };

  it("maps timeline kinds to published events and leaves internal ones out", () => {
    expect(events.webhookEventFor("approved")).toBe("booking.confirmed");
    expect(events.webhookEventFor("checked-in")).toBe("booking.checked_in");
    expect(events.webhookEventFor("held")).toBeNull();
    expect(events.webhookEventFor("manage-link-sent")).toBeNull();
  });

  it("builds payloads without personal data and keeps only safe event fields", () => {
    const payload = events.webhookPayload({ eventId: "e1", event: "booking.cancelled", createdAt: new Date(t(1)), makerspaceSlug: "tinkerspace", occurrenceId: null, data: { scope: "ALL", reason: "Private note", keptFeeMinor: 0 }, booking, now: new Date(t(1)) });
    const text = JSON.stringify(payload);
    expect(text).not.toContain("asha@example.test");
    expect(text).not.toContain("Asha");
    expect(text).not.toContain("Private note");
    expect(payload.data).toMatchObject({ scope: "ALL", keptFeeMinor: 0, booking: { reference: "BK-7Q2M9X", paymentState: "PAID", space: { slug: "room" } } });
  });

  it("signs t.body with HMAC-SHA256 and backs off, then gives up", () => {
    const expected = crypto.createHmac("sha256", "whsec_x").update("1700000000.{}").digest("hex");
    expect(events.signWebhook("whsec_x", "{}", 1_700_000_000)).toBe(`t=1700000000,v1=${expected}`);
    const now = new Date(t(0));
    expect(events.nextAttemptAfter(1, now)).toEqual(new Date(t(0) + 60_000));
    expect(events.nextAttemptAfter(events.RETRY_DELAYS_MS.length, now)).toEqual(new Date(t(0) + 24 * H));
    expect(events.nextAttemptAfter(events.RETRY_DELAYS_MS.length + 1, now)).toBeNull();
  });
});

describe("API keys and the OpenAPI document", () => {
  it("parses only well-formed bearer keys", () => {
    const secret = "a".repeat(43);
    expect(parseApiKey(`Bearer swb_abcdef123456_${secret}`)).toEqual({ prefix: "abcdef123456", secret });
    expect(parseApiKey(`bearer swb_abcdef123456_${secret}`)).not.toBeNull();
    expect(parseApiKey(`swb_abcdef123456_${secret}`)).toBeNull();
    expect(parseApiKey("Bearer swb_short_x")).toBeNull();
    expect(parseApiKey(null)).toBeNull();
  });

  it("documents exactly the routes that exist", () => {
    const document = openApiDocument();
    expect(Object.keys(document.paths).sort()).toEqual([...API_PATHS].sort());
    for (const route of API_PATHS) {
      const folder = route.replace("{spaceId}", "[spaceId]").replace("{reference}", "[reference]");
      expect(existsSync(path.join(process.cwd(), "app", "api", "v1", ...folder.split("/").filter(Boolean), "route.ts")), route).toBe(true);
    }
    expect(Object.keys(document.webhooks)).toEqual([...events.WEBHOOK_EVENTS]);
  });
});

describe("audit labels", () => {
  it("keeps acronyms upper case", async () => {
    const { auditWords } = await import("@/lib/bookings/ui");
    expect(auditWords("API_KEY_CREATED")).toBe("API key created");
    expect(auditWords("BOOKING_REFUNDED")).toBe("Booking refunded");
    expect(auditWords("MFA_RESET")).toBe("MFA reset");
  });
});
