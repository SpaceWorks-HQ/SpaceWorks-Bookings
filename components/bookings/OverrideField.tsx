"use client";

import { useState } from "react";
import { CheckField, TextField, text } from "./FormFields";

export function OverrideField() {
  const [override, setOverride] = useState(false);
  return <div className="flex flex-col gap-3">
    <div onChange={(event) => setOverride((event.target as HTMLInputElement).checked)}><CheckField name="override" label="Override booking rules" checked={override} /></div>
    {override ? <TextField name="overrideReason" label="Reason for overriding the rules" required helper="Availability conflicts can never be overridden." /> : null}
  </div>;
}
export function overrideInput(data: FormData) {
  if (!data.has("override")) return {};
  const reason = text(data, "overrideReason");
  if (!reason) throw new Error("Enter a reason for overriding the rules.");
  return { overrideReason: reason };
}
