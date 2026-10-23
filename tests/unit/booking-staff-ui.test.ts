import { describe, expect, it } from "vitest";
import { BOOKING_STATUSES, eventReason, groupBySpace, instantToLocalInput, localDayRange, localInputToIso, minuteText, parseMinute, snapshotLines, words } from "@/lib/bookings/ui";
import { DEFAULT_RULES, MONEY_RULE_KEYS, RULE_KEYS, RULE_SHAPE, isMoneyRule } from "@/lib/bookingRules/schema";
import { RULE_GROUPS, RULE_LABELS, RULE_OPTIONS, ruleFormPatch, ruleValue } from "@/lib/bookingRules/fields";

describe("staff booking form mapping", () => {
  it("groups every rule once and labels every field", () => {
    const grouped = RULE_GROUPS.flatMap((group) => group.keys);
    expect([...grouped].sort()).toEqual([...RULE_KEYS].sort());
    expect(new Set(grouped).size).toBe(RULE_KEYS.length);
    for (const key of RULE_KEYS) expect(RULE_LABELS[key]).toBeTruthy();
  });

  const form = () => {
    const data = new FormData();
    for (const key of RULE_KEYS) {
      const value = DEFAULT_RULES[key];
      data.set(`source-${key}`, "space");
      if (value === true) data.set(key, "on");
      else if (value !== false) data.set(key, Array.isArray(value) ? value.join(", ") : String(value));
    }
    return data;
  };
  it("round-trips the makerspace rules through form fields", () => {
    expect(ruleFormPatch(form(), true, false)).toEqual(DEFAULT_RULES);
    for (const [key, options] of Object.entries(RULE_OPTIONS)) {
      for (const option of options) expect(RULE_SHAPE[key as keyof typeof RULE_SHAPE].safeParse(option).success).toBe(true);
    }
  });
  it("never submits money fields without payment-settings access", () => {
    const patch = ruleFormPatch(form(), false, false);
    for (const key of MONEY_RULE_KEYS) expect(patch).not.toHaveProperty(key);
    expect(Object.keys(patch).length).toBe(RULE_KEYS.filter((key) => !isMoneyRule(key)).length);
  });
  it("removes inherited overrides while preserving explicit zero, false and no reminders", () => {
    const data = form();
    data.set("source-approvalMode", "makerspace");
    data.set("bufferBeforeMinutes", "0");
    data.delete("requestsBlockSlot");
    data.set("reminderHoursBefore", "");
    expect(ruleFormPatch(data, true, true)).toMatchObject({ approvalMode: null, bufferBeforeMinutes: 0, requestsBlockSlot: false, reminderHoursBefore: [] });
    expect(ruleValue("reminderHoursBefore", "24, 48")).toEqual([24, 48]);
  });
});

describe("staff date and display helpers", () => {
  it("allows 24:00 only as a closing time", () => {
    expect(parseMinute("24:00", true)).toBe(1440);
    expect(minuteText(1440)).toBe("24:00");
    expect(minuteText(parseMinute("09:05"))).toBe("09:05");
    for (const value of ["24:01", "25:00", "12:60", "9:00", "", "-1:00"]) expect(() => parseMinute(value, true)).toThrow();
    expect(() => parseMinute("24:00")).toThrow();
  });
  it("uses the makerspace zone rather than the browser zone", () => {
    const value = localInputToIso("2026-10-23T09:30", "Asia/Kolkata");
    expect(value).toBe("2026-10-23T04:00:00.000Z");
    expect(instantToLocalInput(value, "Asia/Kolkata")).toBe("2026-10-23T09:30");
    expect(localInputToIso("2026-10-23T24:00", "Asia/Kolkata", true)).toBe("2026-10-23T18:30:00.000Z");
    expect(() => localInputToIso("invalid", "UTC")).toThrow();
  });
  it("rejects missing DST times and resolves folds consistently", () => {
    expect(() => localInputToIso("2026-03-29T01:30", "Europe/London")).toThrow(/clocks change/);
    expect(localInputToIso("2026-10-25T01:30", "Europe/London")).toBe("2026-10-25T00:30:00.000Z");
    expect(localInputToIso("2026-10-25T01:30", "Europe/London", true)).toBe("2026-10-25T01:30:00.000Z");
    const range = localDayRange("2026-10-25", "Europe/London")!;
    expect(range.end.getTime() - range.start.getTime()).toBe(25 * 3600000);
    expect(localDayRange("2026-02-30", "UTC")).toBeNull();
  });
  it("groups spaces without changing the occurrence order", () => {
    const rows = [{ spaceId: "room", id: "a" }, { spaceId: "hall", id: "b" }, { spaceId: "room", id: "c" }];
    expect(groupBySpace(rows)).toEqual({ room: [rows[0], rows[2]], hall: [rows[1]] });
    expect(groupBySpace([])).toEqual({});
  });
  it("reads frozen taxed amounts and handles unpriced holds", () => {
    expect(snapshotLines({ lines: [{ description: "Studio", detail: "One hour", amountMinor: 11800, taxableMinor: 10000 }, null, { description: "Bad", amountMinor: "100" }] }))
      .toEqual([{ description: "Studio", detail: "One hour", totalMinor: 11800 }]);
    for (const value of [null, {}, { lines: "invalid" }]) expect(snapshotLines(value)).toEqual([]);
    expect(words("PARTIALLY_PAID")).toBe("Partially paid");
    expect(BOOKING_STATUSES).toContain("REQUESTED");
    expect(eventReason({ reason: "Customer request" })).toBe("Customer request");
    expect(eventReason({ overrideReason: "Staffed outside opening hours" })).toBe("Staffed outside opening hours");
    expect(eventReason(null)).toBeNull();
    expect(eventReason({ email: "private@example.test" })).toBeNull();
  });
});
