"use client";

import { useState } from "react";
import { updateBookingSettings, updateSpaceRuleOverrides } from "@/app/actions/booking-settings";
import { RULE_GROUPS, RULE_LABELS, RULE_OPTIONS, ruleFormPatch } from "@/lib/bookingRules/fields";
import { isMoneyRule, type BookingRules, type RuleKey } from "@/lib/bookingRules/schema";
import type { EffectiveRules } from "@/lib/bookingRules/effective";
import { ActionForm } from "@/components/bookings/ActionForm";
import { CheckField, SelectField, TextField } from "@/components/bookings/FormFields";
import { Card, CardHeader } from "@/components/ui/display";
import { Dropdown, Field } from "@/components/ui/field";

function RuleField({ ruleKey, value, disabled }: { ruleKey: RuleKey; value: BookingRules[RuleKey]; disabled: boolean }) {
  const label = RULE_LABELS[ruleKey];
  if (typeof value === "boolean") return <CheckField name={ruleKey} label={label} checked={value} disabled={disabled} />;
  if (RULE_OPTIONS[ruleKey]) return <SelectField name={ruleKey} label={label} value={String(value)} options={RULE_OPTIONS[ruleKey]!} disabled={disabled} />;
  return <TextField name={ruleKey} label={label} value={Array.isArray(value) ? value.join(", ") : value} type={typeof value === "number" ? "number" : "text"} required={typeof value === "number"} disabled={disabled} />;
}

export function BookingRulesForm({ slug, spaceId, rules, defaults, canMoney }: {
  slug: string; spaceId?: string; rules: EffectiveRules; defaults: BookingRules; canMoney: boolean;
}) {
  const [sources, setSources] = useState(rules.sources);
  return <ActionForm<unknown> guard label="Save booking rules" action={(data) => {
    const patch = ruleFormPatch(data, canMoney, Boolean(spaceId));
    return spaceId ? updateSpaceRuleOverrides({ makerspaceSlug: slug, spaceId, patch }) : updateBookingSettings({ makerspaceSlug: slug, patch });
  }}>
    {RULE_GROUPS.map((group) => <Card as="section" key={group.title}>
      <CardHeader title={group.title} description={group.title === "Payment defaults" && !canMoney ? "Payment settings are read-only with your access." : undefined} />
      <div className="grid gap-5 sm:grid-cols-2">{group.keys.map((key) => {
        const locked = isMoneyRule(key) && !canMoney;
        return <div key={key} className="flex flex-col gap-2">
          {spaceId ? <Field label={`${RULE_LABELS[key]} source`}><Dropdown name={`source-${key}`} value={sources[key]} disabled={locked}
            onChange={(event) => setSources({ ...sources, [key]: event.target.value as "space" | "makerspace" })}>
            <option value="makerspace">Inherited from makerspace</option><option value="space">Override for this space</option>
          </Dropdown></Field> : null}
          <RuleField key={`${key}-${sources[key]}`} ruleKey={key} value={spaceId && sources[key] === "makerspace" ? defaults[key] : rules.values[key]} disabled={locked || Boolean(spaceId && sources[key] === "makerspace")} />
        </div>;
      })}</div>
    </Card>)}
  </ActionForm>;
}
