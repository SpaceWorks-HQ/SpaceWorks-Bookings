import { beforeEach, describe, expect, it, vi } from "vitest";

const render = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ics/feeds", () => ({ renderCalendarFeed: render }));
import { GET } from "@/app/api/calendar/[token]/route";

beforeEach(() => vi.resetAllMocks());
describe("private calendar subscription route", () => {
  const token = "a".repeat(43);
  const request = new Request("https://bookings.example.test/api/calendar/feed");
  it("returns a private, uncached calendar", async () => {
    render.mockResolvedValue("BEGIN:VCALENDAR\r\nEND:VCALENDAR");
    const response = await GET(request, { params: Promise.resolve({ token }) });
    expect(render).toHaveBeenCalledWith(token);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await response.text()).toContain("BEGIN:VCALENDAR");
  });
  it("treats unknown and revoked feeds as not found", async () => {
    render.mockResolvedValue(null);
    expect((await GET(request, { params: Promise.resolve({ token }) })).status).toBe(404);
  });
  it("rejects malformed tokens before querying", async () => {
    expect((await GET(request, { params: Promise.resolve({ token: "invalid" }) })).status).toBe(404);
    expect(render).not.toHaveBeenCalled();
  });
});
