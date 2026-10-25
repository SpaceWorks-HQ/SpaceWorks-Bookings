import { afterEach, describe, expect, it, vi } from "vitest";
import * as b from "@/lib/actions/bookingInputs";
import * as s from "@/lib/actions/settingsInputs";

const slug = { makerspaceSlug: "tinkerspace" };
const space = { ...slug, spaceId: "room" };
const booking = { ...slug, bookingId: "booking" };
const slot = { start: "2026-11-01T09:00:00+05:30", end: "2026-11-01T10:00:00+05:30" };
const hold = { ...space, ...slot };
const contact = { name: "Customer", email: " Customer@Example.test " };
const submit = { ...booking, contact, attendees: 2 };
const reschedule = { ...booking, ...slot, occurrenceId: "occurrence" };
const manageToken = "x".repeat(43);

// Each action boundary has a valid fixture, including dates that cross the RPC transport as strings.
const valid = [
  ["scope", b.scopeSchema, slug], ["slug", b.slugSchema, slug], ["space id", b.spaceIdSchema, space],
  ["contact", b.contactSchema, contact], ["recurrence", b.recurrenceSchema, { frequency: "WEEKLY", count: 4 }],
  ["slot", b.slotSchema, slot], ["hold", b.holdSchema, hold], ["staff hold", b.staffHoldSchema, { ...hold, overrideReason: "Agreed by manager" }],
  ["quote", b.quoteSchema, hold], ["booking id", b.bookingIdSchema, booking], ["submit", b.submitSchema, submit],
  ["staff submit", b.staffSubmitSchema, { ...submit, internalNotes: "At desk" }],
  ["cancel scope", b.cancelScopeSchema, { type: "FOLLOWING", occurrenceId: "o" }],
  ["cancel", b.cancelSchema, booking], ["staff cancel", b.staffCancelSchema, { ...booking, kind: "VENUE", reason: "Repairs" }],
  ["reschedule", b.rescheduleSchema, reschedule], ["staff reschedule", b.staffRescheduleSchema, reschedule],
  ["approve", b.approveSchema, booking], ["decline", b.declineSchema, { ...booking, reason: "Closed" }],
  ["move", b.moveSchema, { ...booking, toSpaceId: "room2" }], ["occurrence", b.occurrenceSchema, { ...slug, occurrenceId: "o" }],
  ["check-in", b.checkInSchema, booking], ["check-in code", b.checkInCodeSchema, { ...slug, code: "BK-123456-12345678" }],
  ["manage link", b.manageLinkSchema, { ...slug, reference: "BK-123456", email: contact.email }],
  ["token cancel", b.tokenCancelSchema, { ...slug, manageToken }],
  ["token reschedule", b.tokenRescheduleSchema, { ...slug, ...slot, occurrenceId: "o", manageToken }],
  ["defaults", s.bookingSettingsSchema, { ...slug, patch: { guestBookingAllowed: true } }],
  ["overrides", s.spaceRulesSchema, { ...space, patch: { chargeMode: null, guestBookingAllowed: false } }],
  ["create space", s.createSpaceSchema, { ...slug, fields: { name: "Room" } }],
  ["update space", s.updateSpaceSchema, { ...space, fields: { taxRateBps: null } }],
  ["archive", s.archiveSpaceSchema, { ...space, archived: true }],
  ["photo", s.photoUploadSchema, { ...space, file: new File(["bytes"], "photo.png"), alt: "Room" }],
  ["remove photo", s.removePhotoSchema, { ...slug, photoId: "p" }],
  ["reorder photos", s.reorderPhotosSchema, { ...space, photoIds: ["p2", "p1"] }],
  ["add-on", s.saveAddOnSchema, { ...space, addOn: { name: "Tea", unit: "PER_PERSON", priceMinor: 100 } }],
  ["remove add-on", s.removeAddOnSchema, { ...slug, addOnId: "a" }],
  ["peak", s.savePeakSchema, { ...space, rule: { name: "Weekend", weekdays: [0, 6], startMinute: 0, endMinute: 1440, surchargeBps: 1000 } }],
  ["remove peak", s.removePeakSchema, { ...slug, ruleId: "r" }],
  ["tiers", s.refundTiersSchema, { ...slug, tiers: [{ minHoursBefore: 24, refundBps: 10000 }] }],
  ["hours", s.openingHoursSchema, { ...slug, hours: [{ weekday: 1, openMinute: 0, closeMinute: 1440 }] }],
  ["exception", s.hoursExceptionSchema, { ...space, exception: { date: "2026-11-01", closed: true } }],
  ["remove exception", s.removeExceptionSchema, { ...space, exceptionId: "e" }],
  ["blackout", s.createBlackoutSchema, { ...slug, blackout: { startDate: "2026-11-01", endDate: "2026-11-02" } }],
  ["timed blackout", s.createBlackoutSchema, { ...space, blackout: { startsAt: slot.start, endsAt: slot.end } }],
  ["remove blackout", s.removeBlackoutSchema, { ...slug, blackoutId: "b" }],
  ["member", s.upsertMemberSchema, { ...slug, member: { email: contact.email, validUntil: "2028-02-29" } }],
  ["remove member", s.removeMemberSchema, { ...slug, memberId: "m" }],
  ["import", s.importMembersSchema, { ...slug, csv: "email\ncustomer@example.test" }],
] as const;

describe("booking action input schemas", () => {
  afterEach(() => vi.useRealTimers());
  it("caps every slot boundary at seven days and two years ahead", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-23T00:00Z"));
    for (const [schema, input] of [[b.slotSchema, slot], [b.holdSchema, hold], [b.quoteSchema, hold],
      [b.staffHoldSchema, hold], [b.rescheduleSchema, reschedule], [b.staffRescheduleSchema, reschedule],
      [b.tokenRescheduleSchema, { ...slug, ...slot, occurrenceId: "o", manageToken }]] as const) {
      expect(schema.safeParse({ ...input, end: "2026-11-09T09:00:00+05:30" }).success).toBe(false);
      expect(schema.safeParse({ ...input, start: "2035-11-01T09:00:00Z", end: "2035-11-01T10:00:00Z" }).success).toBe(false);
    }
    expect(b.recurrenceSchema.safeParse({ frequency: "DAILY", until: "2028-10-24" }).success).toBe(false);
    expect(b.recurrenceSchema.safeParse({ frequency: "DAILY", until: "2028-10-23" }).success).toBe(true);
    expect(b.slotSchema.safeParse({ start: "2026-11-01T09:00:00Z", end: "2026-11-08T09:00:00Z" }).success).toBe(true);
  });
  it("requires explicit consent for empty makerspace hours, while empty space hours inherit", () => {
    expect(s.openingHoursSchema.safeParse({ ...slug, hours: [] }).success).toBe(false);
    expect(s.openingHoursSchema.safeParse({ ...slug, hours: [], openAllDay: true }).success).toBe(true);
    expect(s.openingHoursSchema.safeParse({ ...space, hours: [] }).success).toBe(true);
  });
  it.each(valid)("accepts %s", (_name, schema, input) => expect(schema.safeParse(input).success).toBe(true));
  it.each(valid.filter(([name]) => !["contact", "slot", "recurrence", "cancel scope"].includes(name)))("refuses caller-supplied actors in %s", (_name, schema, input) => {
    expect(schema.safeParse({ ...input, actor: { kind: "SYSTEM" }, makerspaceId: "other" }).success).toBe(false);
  });
  it("normalises contact emails and preserves explicit inheritance, false and zero", () => {
    expect(b.contactSchema.parse(contact).email).toBe("customer@example.test");
    expect(s.spaceRulesSchema.parse({ ...space, patch: { chargeMode: null, guestBookingAllowed: false, leadTimeMinutes: 0 } }).patch)
      .toEqual({ chargeMode: null, guestBookingAllowed: false, leadTimeMinutes: 0 });
  });
  it.each([
    [b.holdSchema, { ...hold, end: slot.start }], [b.quoteSchema, { ...hold, quantity: 0 }],
    [b.holdSchema, { ...hold, start: "2026-11-01T09:00:00" }],
    [b.staffHoldSchema, { ...hold, overrideReason: " " }],
    [b.staffCancelSchema, { ...booking, kind: "VENUE" }],
    [b.rescheduleSchema, { ...reschedule, end: slot.start }],
    [b.staffRescheduleSchema, { ...reschedule, end: slot.start }],
    [b.tokenRescheduleSchema, { ...slug, ...slot, end: slot.start, occurrenceId: "o", manageToken }],
    [b.recurrenceSchema, { frequency: "DAILY" }], [b.recurrenceSchema, { frequency: "DAILY", count: 105 }],
    [b.recurrenceSchema, { frequency: "DAILY", until: "2026-02-30" }],
    [b.cancelScopeSchema, { type: "FOLLOWING" }], [b.checkInSchema, slug],
    [b.submitSchema, { ...submit, internalNotes: "Injected" }], [b.quoteSchema, { ...hold, memberEmail: "other@example.test" }],
    [b.addOnSelections, [{ addOnId: "a", quantity: 1 }, { addOnId: "a", quantity: 1 }]],
    [s.bookingSettingsSchema, { ...slug, patch: { chargeMode: "CHOICE" } }],
    [s.spaceRulesSchema, { ...space, patch: { unknownRule: true } }],
    [s.updateSpaceSchema, { ...space, fields: { ruleOverrides: { chargeMode: "FREE" } } }],
    [s.reorderPhotosSchema, { ...space, photoIds: ["p", "p"] }],
    [s.photoUploadSchema, { ...space, file: "https://example.test/image.png" }],
    [s.openingHoursSchema, { ...slug, hours: [{ weekday: 7, openMinute: 0, closeMinute: 1440 }] }],
    [s.openingHoursSchema, { ...slug, hours: [{ weekday: 1, openMinute: 60, closeMinute: 30 }] }],
    [s.refundTiersSchema, { ...slug, tiers: [{ minHoursBefore: 1, refundBps: 10001 }] }],
    [s.upsertMemberSchema, { ...slug, member: { email: "invalid", validUntil: "2026-02-30" } }],
    [s.importMembersSchema, { ...slug, csv: "\u00e9".repeat(1024 * 1024 + 1) }],
  ])("rejects invalid input %#", (schema, input) => expect(schema.safeParse(input).success).toBe(false));
});
