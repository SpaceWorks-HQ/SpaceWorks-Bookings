import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const model = () => ({ findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn(), count: vi.fn() });
  return { access: vi.fn(), save: vi.fn(), revalidate: vi.fn(), upload: vi.fn(), deleteFiles: vi.fn(), derivative: vi.fn(), limited: vi.fn(),
    db: { space: model(), spacePhoto: model(), addOn: model(), peakRule: model(), refundTier: model(), openingHours: model(), hoursException: model(), blackout: model(), makerspaceMember: model(), makerspaceBookingSettings: model(), bookingOccurrence: model(), $transaction: vi.fn() } };
});
vi.mock("@/lib/db", () => ({ prisma: mocks.db }));
vi.mock("@/lib/permissions", () => ({ makerspaceActionAccess: mocks.access }));
vi.mock("@/lib/settingsAudit", () => ({ saveSetting: mocks.save }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: mocks.limited }));
vi.mock("@/lib/imageValidation", () => ({ createSafeWebpDerivative: mocks.derivative }));
vi.mock("@/lib/storage", () => ({ uploadFile: mocks.upload, deleteFiles: mocks.deleteFiles, getPublicUrl: (key: string) => `/api/uploads/${key}` }));

import * as rules from "@/app/actions/booking-settings";
import * as spaces from "@/app/actions/spaces";
import * as calendar from "@/app/actions/space-calendar";
import * as members from "@/app/actions/members";

const slug = { makerspaceSlug: "tinkerspace" };
const scope = { ...slug, spaceId: "room" };
const row = { id: "room", makerspaceId: "tenant", name: "Room", slug: "room", ruleOverrides: {}, units: 2, halfDayMinutes: 240, dayMinutes: 480, published: true, archivedAt: null, taxRateBps: null, sacCode: null };
const photo = { id: "p", makerspaceId: "tenant", spaceId: "room", url: "/image", storageKey: null, alt: "Room", sortOrder: 0 };
const addOn = { id: "a", makerspaceId: "tenant", spaceId: "room", name: "Tea", unit: "PER_PERSON", priceMinor: 100, memberPriceMinor: null, sacCode: null, active: true };
const exception = { id: "e", makerspaceId: "tenant", spaceId: "room", date: new Date("2026-11-01Z"), closed: true, intervals: [], reason: "Closed" };
const blackout = { id: "b", makerspaceId: "tenant", spaceId: "room", startDate: new Date("2026-11-01Z"), endDate: new Date("2026-11-02Z"), startsAt: null, endsAt: null, reason: "Repairs" };
const member = { id: "m", makerspaceId: "tenant", email: "customer@example.test", name: "Customer", note: "", active: true, validUntil: null };

function upload() {
  const form = new FormData();
  form.set("makerspaceSlug", slug.makerspaceSlug); form.set("spaceId", "room"); form.set("file", new File(["image"], "room.png"));
  return form;
}
const cases = [
  [rules, "updateBookingSettings", { ...slug, patch: { guestBookingAllowed: true } }, "booking-rules"],
  [rules, "updateSpaceRuleOverrides", { ...scope, patch: { guestBookingAllowed: true } }, "space-rules"],
  [spaces, "createSpace", { ...slug, fields: { name: "Studio" } }, "space"],
  [spaces, "updateSpace", { ...scope, fields: { name: "Studio" } }, "space"],
  [spaces, "setSpaceArchived", { ...scope, archived: true }, "space"],
  [spaces, "addSpacePhoto", upload(), "space-photo"],
  [spaces, "removeSpacePhoto", { ...slug, photoId: "p" }, "space-photo"],
  [spaces, "reorderSpacePhotos", { ...scope, photoIds: ["p"] }, "space-photos"],
  [spaces, "saveAddOn", { ...scope, addOn: { name: "Tea", unit: "PER_PERSON", priceMinor: 100 } }, "add-on"],
  [spaces, "removeAddOn", { ...slug, addOnId: "a" }, "add-on"],
  [spaces, "savePeakRule", { ...scope, rule: { name: "Peak", weekdays: [1], startMinute: 0, endMinute: 1440, surchargeBps: 100 } }, "peak-rule"],
  [spaces, "removePeakRule", { ...slug, ruleId: "r" }, "peak-rule"],
  [spaces, "replaceRefundTiers", { ...scope, tiers: [{ minHoursBefore: 24, refundBps: 10000 }] }, "refund-tiers"],
  [calendar, "replaceOpeningHours", { ...scope, hours: [{ weekday: 1, openMinute: 0, closeMinute: 1440 }] }, "opening-hours"],
  [calendar, "setHoursException", { ...scope, exception: { date: "2026-11-01", closed: true } }, "hours-exception"],
  [calendar, "removeHoursException", { ...scope, exceptionId: "e" }, "hours-exception"],
  [calendar, "createBlackout", { ...scope, blackout: { startDate: "2026-11-01", endDate: "2026-11-02" } }, "blackout"],
  [calendar, "removeBlackout", { ...scope, blackoutId: "b" }, "blackout"],
  [members, "upsertMember", { ...slug, member: { email: member.email } }, "member"],
  [members, "removeMember", { ...slug, memberId: "m" }, "member"],
  [members, "importMembersCsv", { ...slug, csv: "email,name\ncustomer@example.test,Customer" }, "member"],
] as const;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({ ok: true, makerspace: { id: "tenant", slug: "tinkerspace", status: "ACTIVE" }, userId: "staff", membership: { role: "BOOKINGS_MANAGER" } });
  mocks.db.$transaction.mockImplementation(async (callback) => callback(mocks.db));
  for (const [name, model] of Object.entries(mocks.db)) {
    if (name === "$transaction") continue;
    const methods = model as typeof mocks.db.space;
    methods.findMany.mockResolvedValue([]); methods.findUnique.mockResolvedValue(null); methods.count.mockResolvedValue(0);
  }
  mocks.db.space.findFirst.mockResolvedValue(row);
  mocks.db.space.create.mockResolvedValue(row);
  mocks.db.space.update.mockImplementation(async ({ data }) => ({ ...row, ...data }));
  // Slug generation must see no existing row; scoped id lookups still find the space.
  mocks.db.space.findFirst.mockImplementation(async ({ where }) => where.slug ? null : row);
  mocks.db.spacePhoto.findFirst.mockResolvedValue(photo); mocks.db.spacePhoto.findMany.mockResolvedValue([photo]); mocks.db.spacePhoto.create.mockResolvedValue(photo);
  mocks.db.addOn.findFirst.mockResolvedValue(addOn); mocks.db.addOn.create.mockResolvedValue(addOn); mocks.db.addOn.update.mockResolvedValue(addOn);
  mocks.db.peakRule.findFirst.mockResolvedValue({ ...addOn, id: "r", weekdays: [1], startMinute: 0, endMinute: 1440, surchargeBps: 100 });
  mocks.db.peakRule.create.mockResolvedValue({ ...addOn, id: "r", weekdays: [1], startMinute: 0, endMinute: 1440, surchargeBps: 100 });
  mocks.db.hoursException.findFirst.mockResolvedValue(exception); mocks.db.hoursException.update.mockResolvedValue(exception);
  mocks.db.blackout.findFirst.mockResolvedValue(blackout); mocks.db.blackout.create.mockResolvedValue(blackout);
  mocks.db.makerspaceMember.findFirst.mockResolvedValue(member); mocks.db.makerspaceMember.create.mockResolvedValue(member);
  mocks.derivative.mockResolvedValue({ body: Buffer.from("webp") }); mocks.deleteFiles.mockResolvedValue(undefined);
});

describe("every settings write is audited", () => {
  it("does not erase makerspace hours without the explicit all-day choice", async () => {
    expect(await calendar.replaceOpeningHours({ ...slug, hours: [] })).toMatchObject({ ok: false, fieldErrors: { hours: [expect.stringContaining("Add opening hours for at least one day.")] } });
    expect(mocks.db.openingHours.deleteMany).not.toHaveBeenCalled();
    expect(await calendar.replaceOpeningHours({ ...slug, hours: [], openAllDay: true })).toMatchObject({ ok: true });
    expect(await calendar.replaceOpeningHours({ ...scope, hours: [] })).toMatchObject({ ok: true });
  });
  it("enumerates every exported settings-changing action", () => {
    const expected = cases.map(([, name]) => name).sort();
    expect([rules, spaces, calendar, members].flatMap((module) => Object.keys(module)).sort()).toEqual(expected);
  });
  it.each(cases)("audits action %# (%s)", async (module, name, input, area) => {
    const action = (module as Record<string, (input: unknown) => Promise<{ ok: boolean }>>)[name];
    const result = await action(input);
    expect(result).toMatchObject({ ok: true });
    expect(mocks.save).toHaveBeenCalledWith(mocks.db, expect.objectContaining({ area, makerspaceId: "tenant", actorUserId: "staff" }));
    expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard/tinkerspace", "layout");
    expect(mocks.revalidate).toHaveBeenCalledWith("/m/tinkerspace", "layout");
  });
  it("validates before checking permissions or writing", async () => {
    const result = await spaces.updateSpace({ ...scope, fields: { units: 0 } });
    expect(result).toMatchObject({ ok: false, fieldErrors: { fields: expect.any(Array) } });
    expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("requires payments.settings for money rules and tax resets", async () => {
    await rules.updateBookingSettings({ ...slug, patch: { chargeMode: "FREE" } });
    expect(mocks.access).toHaveBeenCalledWith("tinkerspace", "payments.settings");
    mocks.access.mockResolvedValue({ ok: true, makerspace: { id: "tenant" }, userId: "staff", membership: { role: "FRONT_DESK" } });
    mocks.save.mockClear();
    expect(await rules.updateSpaceRuleOverrides({ ...scope, patch: { chargeMode: null } })).toMatchObject({ ok: false });
    expect(await spaces.updateSpace({ ...scope, fields: { sacCode: null } })).toMatchObject({ ok: false });
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("gates makerspace calendars and refund tiers with their own capabilities", async () => {
    await calendar.replaceOpeningHours({ ...slug, hours: [], openAllDay: true });
    expect(mocks.access).toHaveBeenLastCalledWith("tinkerspace", "makerspace.settings");
    await spaces.replaceRefundTiers({ ...slug, tiers: [] });
    expect(mocks.access).toHaveBeenLastCalledWith("tinkerspace", "payments.settings");
  });
  it("lets bookings managers change an add-on's SAC (they hold payments.settings) and refuses roles without spaces.manage", async () => {
    mocks.access.mockResolvedValue({ ok: true, makerspace: { id: "tenant" }, userId: "staff", membership: { role: "BOOKINGS_MANAGER" } });
    mocks.db.addOn.findFirst.mockResolvedValue({ ...addOn, sacCode: "998399" });
    const fields = { name: "Updated tea", unit: "PER_PERSON", priceMinor: 100, sacCode: "998398" };
    expect(await spaces.saveAddOn({ ...scope, addOnId: "a", addOn: fields })).toMatchObject({ ok: true });
    mocks.save.mockClear();
    mocks.access.mockResolvedValue({ ok: true, makerspace: { id: "tenant" }, userId: "staff", membership: { role: "FRONT_DESK" } });
    expect(await spaces.saveAddOn({ ...scope, addOnId: "a", addOn: fields })).toMatchObject({ ok: false });
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("does not let a claimed space scope delete a makerspace-wide blackout", async () => {
    mocks.db.blackout.findFirst.mockResolvedValue(null);
    expect(await calendar.removeBlackout({ ...scope, blackoutId: "foreign" })).toEqual({ ok: false, error: "Blackout not found." });
    expect(mocks.db.blackout.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "foreign", makerspaceId: "tenant", spaceId: "room" } }));
    expect(mocks.db.blackout.delete).not.toHaveBeenCalled();
  });
  it("rejects a foreign photo in a reordered set before updating anything", async () => {
    expect(await spaces.reorderSpacePhotos({ ...scope, photoIds: ["foreign"] })).toMatchObject({ ok: false });
    expect(mocks.db.spacePhoto.update).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
});
