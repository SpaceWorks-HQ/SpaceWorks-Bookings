"use client";

import { INDIAN_STATES } from "@/lib/indianStates";
import { Dropdown, Field, Input, Textarea } from "@/components/ui/field";

/** Everything a makerspace tells the platform about itself, as the form holds it. */
export type ProfileValues = {
  name: string;
  kind: string;
  description: string;
  contactEmail: string;
  contactPhone: string;
  website: string;
  addressLine: string;
  city: string;
  stateCode: string;
  postalCode: string;
};

export type FieldErrors = Record<string, string[] | undefined>;

export const EMPTY_PROFILE: ProfileValues = {
  name: "",
  kind: "",
  description: "",
  contactEmail: "",
  contactPhone: "",
  website: "",
  addressLine: "",
  city: "",
  stateCode: "",
  postalCode: "",
};

/** Suggestions only: any kind can be typed. */
const KIND_SUGGESTIONS = ["Club", "Association", "Society", "Alumni association", "Professional body", "Residents' welfare association", "Cooperative", "Trust or NGO", "Student chapter", "Sports club"];

type Props = {
  values: ProfileValues;
  onChange: (next: ProfileValues) => void;
  errors?: FieldErrors;
  disabled?: boolean;
};

function useField(props: Props) {
  return <K extends keyof ProfileValues>(key: K) => ({
    name: key,
    value: props.values[key],
    disabled: props.disabled,
    "aria-invalid": props.errors?.[key]?.length ? true : undefined,
    onChange: (event: { target: { value: string } }) => props.onChange({ ...props.values, [key]: event.target.value }),
  });
}

/** Name, kind and description: who the makerspace is. */
export function AboutFields(props: Props & { autoFocus?: boolean }) {
  const field = useField(props);
  const error = (key: keyof ProfileValues) => props.errors?.[key]?.[0];
  return (
    <>
      <Field label="Makerspace name" required error={error("name")}>
        <Input {...field("name")} autoComplete="makerspace" maxLength={120} autoFocus={props.autoFocus} />
      </Field>
      <Field label="What kind of makerspace is it?" required error={error("kind")} helperText="For example a club, an association or an alumni body.">
        <Input {...field("kind")} list="makerspace-kind-suggestions" maxLength={60} />
      </Field>
      <datalist id="makerspace-kind-suggestions">
        {KIND_SUGGESTIONS.map((kind) => <option key={kind} value={kind} />)}
      </datalist>
      <Field label="What does it do, and who uses its spaces?" required error={error("description")} helperText={`${props.values.description.trim().length} of at least 20 characters. The platform team reads this when reviewing.`}>
        <Textarea {...field("description")} rows={4} maxLength={2000} />
      </Field>
    </>
  );
}

/** How to reach the makerspace, and where it is (its state sets GST place of supply later). */
export function ContactFields(props: Props) {
  const field = useField(props);
  const error = (key: keyof ProfileValues) => props.errors?.[key]?.[0];
  return (
    <>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Contact email" required error={error("contactEmail")} helperText="Shown to customers on receipts and your public page.">
          <Input {...field("contactEmail")} type="email" autoComplete="email" inputMode="email" maxLength={320} />
        </Field>
        <Field label="Contact phone" optional error={error("contactPhone")}>
          <Input {...field("contactPhone")} type="tel" autoComplete="tel" inputMode="tel" maxLength={32} />
        </Field>
      </div>
      <Field label="Website" optional error={error("website")}>
        <Input {...field("website")} type="url" inputMode="url" placeholder="https://" maxLength={300} />
      </Field>
      <Field label="Address" optional error={error("addressLine")}>
        <Input {...field("addressLine")} autoComplete="street-address" maxLength={200} />
      </Field>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-[1fr_1fr_9rem]">
        <Field label="City or town" required error={error("city")}>
          <Input {...field("city")} autoComplete="address-level2" maxLength={80} />
        </Field>
        <Field label="State or union territory" required error={error("stateCode")}>
          <Dropdown {...field("stateCode")}>
            <option value="" disabled>Choose one</option>
            {INDIAN_STATES.map((state) => <option key={state.code} value={state.code}>{state.name}</option>)}
          </Dropdown>
        </Field>
        <Field label="PIN code" optional error={error("postalCode")}>
          <Input {...field("postalCode")} autoComplete="postal-code" inputMode="numeric" maxLength={6} />
        </Field>
      </div>
    </>
  );
}

