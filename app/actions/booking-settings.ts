"use server";

import * as rules from "@/lib/bookingRules/service";
import { isMoneyRule, type RuleKey } from "@/lib/bookingRules/schema";
import { staffAction } from "@/lib/actions/bookingContext";
import { bookingSettingsSchema, spaceRulesSchema } from "@/lib/actions/settingsInputs";

export async function updateBookingSettings(input: unknown) {
  return staffAction(bookingSettingsSchema, input, ({ patch }) => {
    const keys = Object.keys(patch) as RuleKey[];
    return keys.some(isMoneyRule)
      ? keys.some((key) => !isMoneyRule(key)) ? ["makerspace.settings", "payments.settings"] : ["payments.settings"]
      : ["makerspace.settings"];
  }, (data, ctx) => rules.updateBookingSettings({ ...ctx, patch: data.patch }));
}

export async function updateSpaceRuleOverrides(input: unknown) {
  return staffAction(spaceRulesSchema, input,
    ({ patch }) => (Object.keys(patch) as RuleKey[]).some(isMoneyRule) ? ["spaces.manage", "payments.settings"] : ["spaces.manage"],
    (data, ctx) => rules.updateSpaceRuleOverrides({ ...ctx, spaceId: data.spaceId, patch: data.patch }));
}
