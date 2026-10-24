import { RULE_KEYS, RULE_SHAPE, type BookingRules, type RuleKey } from "./schema";

/**
 * The one place booking rules are resolved: makerspace defaults, then the space's overrides. A key present in
 * `ruleOverrides` (even `false` or `0`) wins; an override that no longer validates is ignored, so a bad row can
 * never break booking. Pure and client-safe.
 */

export type RuleSource = "makerspace" | "space";
export type EffectiveRules = { values: BookingRules; sources: Record<RuleKey, RuleSource> };

/** The overrides a space really has: known keys whose values validate. */
export function parseOverrides(raw: unknown): Partial<BookingRules> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Partial<Record<RuleKey, unknown>> = {};
  for (const key of RULE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const parsed = RULE_SHAPE[key].safeParse((raw as Record<string, unknown>)[key]);
    if (parsed.success) result[key] = parsed.data;
  }
  return result as Partial<BookingRules>;
}

export function effectiveRules(defaults: BookingRules, space?: { ruleOverrides: unknown } | null): EffectiveRules {
  const overrides = parseOverrides(space?.ruleOverrides);
  const values = { ...defaults } as Record<RuleKey, unknown>;
  const sources = {} as Record<RuleKey, RuleSource>;
  for (const key of RULE_KEYS) {
    const overridden = Object.prototype.hasOwnProperty.call(overrides, key);
    if (overridden) values[key] = overrides[key];
    sources[key] = overridden ? "space" : "makerspace";
  }
  return { values: values as BookingRules, sources };
}

/** Apply a patch to a space's overrides: a `null` value removes that override (back to inherited). */
export function applyOverridePatch(current: unknown, patch: Partial<Record<RuleKey, unknown>>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...parseOverrides(current) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}
