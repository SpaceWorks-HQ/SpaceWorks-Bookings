import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const mocks = vi.hoisted(() => {
  const model = () => ({ findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), count: vi.fn() });
  return { gate: vi.fn(), db: { makerspace: model(), makerspaceBookingSettings: model(), booking: model(), space: model(), calendarFeed: model(), bookingOccurrence: model(), makerspaceMember: model() } };
});
vi.mock("@/lib/db", () => ({ prisma: mocks.db }));
vi.mock("@/lib/permissions", () => ({ requireMakerspaceCapability: mocks.gate }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404"); } }));
import { loadBookingSettings } from "@/lib/views/app__dashboard__makerspaceSlug__settings__bookings__page";
import { loadHoursSettings } from "@/lib/views/app__dashboard__makerspaceSlug__settings__hours__page";
import { loadSpaces } from "@/lib/views/app__dashboard__makerspaceSlug__spaces__page";
import { loadSpace } from "@/lib/views/app__dashboard__makerspaceSlug__spaces__spaceId__page";
import { loadNewSpace } from "@/lib/views/app__dashboard__makerspaceSlug__spaces__new__page";
import { loadMembers } from "@/lib/views/app__dashboard__makerspaceSlug__members__page";
import { loadBookings } from "@/lib/views/app__dashboard__makerspaceSlug__bookings__page";
import { loadBooking } from "@/lib/views/app__dashboard__makerspaceSlug__bookings__bookingId__page";
import { loadNewBooking } from "@/lib/views/app__dashboard__makerspaceSlug__bookings__new__page";
import { loadToday } from "@/lib/views/app__dashboard__makerspaceSlug__today__page";
import { allowed, pageNumber } from "@/lib/bookings/staffView";
import type { MakerspaceAccessContext } from "@/lib/permissions";

const props = () => ({ params: Promise.resolve({ makerspaceSlug: "demo", spaceId: "foreign", bookingId: "foreign" }), searchParams: Promise.resolve({}) });
const routes = [
  ["settings/bookings", loadBookingSettings, "makerspace.settings"], ["settings/hours", loadHoursSettings, "makerspace.settings"],
  ["spaces", loadSpaces, "spaces.manage"], ["spaces/new", loadNewSpace, "spaces.manage"], ["spaces/[spaceId]", loadSpace, "spaces.manage"],
  ["members", loadMembers, "members.manage"], ["bookings", loadBookings, "bookings.view"], ["bookings/new", loadNewBooking, "bookings.manage"],
  ["bookings/[bookingId]", loadBooking, "bookings.view"], ["today", loadToday, "bookings.view"],
] as const;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.gate.mockResolvedValue({ makerspace: { id: "tenant", slug: "demo", status: "ACTIVE" }, membership: { role: "VIEWER" }, userId: "staff" });
  mocks.db.makerspace.findUniqueOrThrow.mockResolvedValue({ name: "Demo", slug: "demo", timezone: "Asia/Kolkata", currency: "INR", logoUrl: null });
});

describe("staff route boundaries", () => {
  it("bounds directory pages and respects suspended makerspace capabilities", () => {
    for (const input of [undefined, "invalid", "-2", "0"]) expect(pageNumber(input)).toBe(1);
    expect(pageNumber("100000")).toBe(10000);
    expect(pageNumber("3")).toBe(3);
    const access = { makerspace: { status: "SUSPENDED" }, membership: { role: "BOOKINGS_MANAGER" } } as MakerspaceAccessContext;
    expect(allowed(access, "bookings.view")).toBe(true);
    expect(allowed(access, "bookings.manage")).toBe(false);
  });
  it.each(routes)("%s guards before reading any data", async (_route, load, capability) => {
    mocks.gate.mockRejectedValue(new Error("denied"));
    await expect(load(props())).rejects.toThrow("denied");
    expect(mocks.gate).toHaveBeenCalledWith("demo", capability);
    for (const model of Object.values(mocks.db)) for (const method of Object.values(model)) expect(method).not.toHaveBeenCalled();
  });
  it.each(routes)("%s has a matching loader and no page database access", (route) => {
    const page = readFileSync(resolve(`app/dashboard/[makerspaceSlug]/${route}/page.tsx`), "utf8");
    const view = `app__dashboard__makerspaceSlug__${route.replace(/[\[\]]/g, "").replaceAll("/", "__")}__page`;
    expect(existsSync(resolve(`lib/views/${view}.ts`))).toBe(true);
    expect(page).toContain(`@/lib/views/${view}`);
    expect(page).not.toContain("@/lib/db");
    expect(page).not.toContain("@/lib/permissions");
  });
  it("returns 404 for a booking or space outside the makerspace", async () => {
    mocks.db.space.findFirst.mockResolvedValue(null);
    mocks.db.booking.findFirst.mockResolvedValue(null);
    await expect(loadSpace(props())).rejects.toThrow("404");
    await expect(loadBooking(props())).rejects.toThrow("404");
    for (const model of [mocks.db.space, mocks.db.booking]) expect(model.findFirst.mock.calls[0][0].where).toEqual({ id: "foreign", makerspaceId: "tenant" });
  });
  it("scopes booking filters to local dates and withholds contact search and selection from viewers", async () => {
    mocks.db.booking.findMany.mockResolvedValue([]);
    mocks.db.booking.count.mockResolvedValue(0);
    mocks.db.space.findMany.mockResolvedValue([]);
    mocks.db.calendarFeed.findFirst.mockResolvedValue(null);
    const result = await loadBookings({ ...props(), searchParams: Promise.resolve({ q: "customer@example.test", from: "2026-10-23", to: "2026-10-23", status: "CONFIRMED" }) });
    const query = mocks.db.booking.findMany.mock.calls[0][0];
    expect(query.where.makerspaceId).toBe("tenant");
    expect(query.where.OR).toEqual([{ reference: { contains: "customer@example.test", mode: "insensitive" } }]);
    expect(query.select.contactName).toBe(false);
    expect(query.select.contactEmail).toBe(false);
    expect(query.where.occurrences.some.startsAt).toEqual({ gte: new Date("2026-10-22T18:30Z"), lt: new Date("2026-10-23T18:30Z") });
    expect(result.contact).toBe(false);
    expect(result.canManage).toBe(false);
    expect(mocks.db.calendarFeed.findFirst.mock.calls[0][0].where).toMatchObject({ makerspaceId: "tenant", userId: "staff", kind: "STAFF" });
  });
  it("lets authorised staff search contacts", async () => {
    mocks.gate.mockResolvedValue({ makerspace: { id: "tenant", status: "ACTIVE" }, membership: { role: "FRONT_DESK" }, userId: "staff" });
    mocks.db.booking.findMany.mockResolvedValue([]); mocks.db.booking.count.mockResolvedValue(0);
    mocks.db.space.findMany.mockResolvedValue([]); mocks.db.calendarFeed.findFirst.mockResolvedValue(null);
    const result = await loadBookings({ ...props(), searchParams: Promise.resolve({ q: "Ada" }) });
    const query = mocks.db.booking.findMany.mock.calls[0][0];
    expect(query.where.OR).toHaveLength(3);
    expect(query.select.contactName).toBe(true);
    expect(result.canManage).toBe(true);
  });
});
