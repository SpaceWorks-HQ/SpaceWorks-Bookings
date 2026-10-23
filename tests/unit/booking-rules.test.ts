import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyOverridePatch, effectiveRules, parseOverrides } from "@/lib/bookingRules/effective";
import { crossRuleProblems, DEFAULT_RULES, isMoneyRule, MONEY_RULE_KEYS, pickRules, RULE_KEYS, rulesPatchSchema, rulesSchema } from "@/lib/bookingRules/schema";
import { settingsDiff } from "@/lib/settingsAudit";

const schema = readFileSync(join(import.meta.dirname, "../../prisma/schema.prisma"), "utf8");
const settingsModel = schema.slice(schema.indexOf("model MakerspaceBookingSettings"), schema.indexOf("model Space {"));

describe("booking rule defaults", () => {
  it("validate and cover every rule key", () => {
    expect(rulesSchema.parse(DEFAULT_RULES)).toEqual(DEFAULT_RULES);
    expect(Object.keys(DEFAULT_RULES).sort()).toEqual([...RULE_KEYS].sort());
    expect(crossRuleProblems(DEFAULT_RULES)).toEqual([]);
  });

  it("match the database column defaults one for one", () => {
    for (const key of RULE_KEYS) {
      const line = settingsModel.split("\n").find((row) => row.trim().startsWith(`${key} `));
      expect(line, key).toBeDefined();
      const match = /@default\((.+)\)\s*$/.exec(line!.trim());
      expect(match, key).not.toBeNull();
      const raw = match![1];
      const expected = DEFAULT_RULES[key];
      const value = Array.isArray(expected) ? JSON.parse(raw) : typeof expected === "number" ? Number(raw) : typeof expected === "boolean" ? raw === "true" : raw;
      expect(value, key).toEqual(expected);
    }
  });

  it("marks the money rules and only real keys", () => {
    for (const key of MONEY_RULE_KEYS) expect(RULE_KEYS).toContain(key);
    expect(isMoneyRule("chargeMode")).toBe(true);
    expect(isMoneyRule("refundTiers" as never)).toBe(false);
    expect(isMoneyRule("minDurationMinutes")).toBe(false);
    expect(isMoneyRule("approvalPayWithinHours")).toBe(true);
  });

  it("falls back to defaults for a missing or broken settings row", () => {
    expect(pickRules(null)).toEqual(DEFAULT_RULES);
    expect(pickRules({ ...DEFAULT_RULES, holdMinutes: -3 })).toEqual(DEFAULT_RULES);
    expect(pickRules({ ...DEFAULT_RULES, holdMinutes: 20, extra: true }).holdMinutes).toBe(20);
  });

  it("sorts and de-duplicates reminder offsets", () => {
    expect(rulesPatchSchema.parse({ reminderHoursBefore: [2, 24, 2] }).reminderHoursBefore).toEqual([24, 2]);
    expect(rulesPatchSchema.safeParse({ reminderHoursBefore: [0] }).success).toBe(false);
    expect(rulesPatchSchema.safeParse({ unknownRule: 1 }).success).toBe(false);
  });

  it("finds rules that only conflict together", () => {
    expect(crossRuleProblems({ ...DEFAULT_RULES, minDurationMinutes: 600, maxDurationMinutes: 60 }).map((p) => p.key)).toContain("maxDurationMinutes");
    expect(crossRuleProblems({ ...DEFAULT_RULES, minDurationMinutes: 45, slotStepMinutes: 30 }).map((p) => p.key)).toContain("minDurationMinutes");
    expect(crossRuleProblems({ ...DEFAULT_RULES, chargeMode: "DEPOSIT", depositKind: "FIXED", depositFixedMinor: 0 }).map((p) => p.key)).toContain("depositFixedMinor");
    expect(crossRuleProblems({ ...DEFAULT_RULES, selfCheckInEnabled: true, selfCheckInOpensMinutesBefore: 0, selfCheckInClosesMinutesAfter: 0 })).toHaveLength(1);
  });
});

describe("effectiveRules", () => {
  it("inherits everything when a space has no overrides", () => {
    const result = effectiveRules(DEFAULT_RULES, { ruleOverrides: {} });
    expect(result.values).toEqual(DEFAULT_RULES);
    expect(new Set(Object.values(result.sources))).toEqual(new Set(["makerspace"]));
  });

  it("lets a present key win even when it is false or zero, and reports the source", () => {
    const defaults = { ...DEFAULT_RULES, guestBookingAllowed: true, leadTimeMinutes: 120 };
    const result = effectiveRules(defaults, { ruleOverrides: { guestBookingAllowed: false, leadTimeMinutes: 0 } });
    expect(result.values.guestBookingAllowed).toBe(false);
    expect(result.values.leadTimeMinutes).toBe(0);
    expect(result.sources.guestBookingAllowed).toBe("space");
    expect(result.sources.holdMinutes).toBe("makerspace");
  });

  it("ignores overrides that no longer validate and unknown keys", () => {
    expect(parseOverrides({ holdMinutes: 9999, chargeMode: "CHOICE", bogus: 1, slotStepMinutes: 15 })).toEqual({ slotStepMinutes: 15 });
    expect(parseOverrides(null)).toEqual({});
    expect(parseOverrides([1, 2])).toEqual({});
    expect(effectiveRules(DEFAULT_RULES, { ruleOverrides: "nonsense" }).values).toEqual(DEFAULT_RULES);
    expect(effectiveRules(DEFAULT_RULES, null).values).toEqual(DEFAULT_RULES);
  });

  it("patches overrides, with null meaning inherit again", () => {
    expect(applyOverridePatch({ holdMinutes: 10, leadTimeMinutes: 0 }, { holdMinutes: null, chargeMode: "PAY_NOW" })).toEqual({ leadTimeMinutes: 0, chargeMode: "PAY_NOW" });
  });
});

describe("settingsDiff", () => {
  it("lists only changed fields and ignores timestamps", () => {
    expect(settingsDiff({ a: 1, b: [1, 2], updatedAt: new Date(1) }, { a: 1, b: [1, 3], updatedAt: new Date(2) })).toEqual({ b: { from: [1, 2], to: [1, 3] } });
  });

  it("records creation and deletion", () => {
    expect(settingsDiff(null, { name: "Studio" })).toEqual({ name: { from: null, to: "Studio" } });
    expect(settingsDiff({ name: "Studio" }, null)).toEqual({ name: { from: "Studio", to: null } });
  });

  it("never stores secrets or redacted personal fields", () => {
    const diff = settingsDiff({ secretEncrypted: "a", webhookSecret: "x", email: "a@b.c", name: "A" }, { secretEncrypted: "b", webhookSecret: "y", email: "c@d.e", name: "B" }, ["email", "name"]);
    expect(JSON.stringify(diff)).not.toMatch(/a@b|c@d|"x"|"y"|"A"|"B"/);
    expect(diff.email).toEqual({ from: "[redacted]", to: "[redacted]" });
    expect(Object.keys(diff).sort()).toEqual(["email", "name", "secretEncrypted", "webhookSecret"]);
  });

  it("turns dates into ISO strings", () => {
    expect(settingsDiff({ at: null }, { at: new Date("2026-11-02T04:30:00Z") })).toEqual({ at: { from: null, to: "2026-11-02T04:30:00.000Z" } });
  });
});
