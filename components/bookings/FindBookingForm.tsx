"use client";
import { useState, useTransition } from "react";
import { requestManageLink } from "@/app/actions/bookings-public";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";

export function FindBookingForm({ slug }: { slug: string }) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return sent ? <Callout role="status" title="Check your email">If bookings match that email address and reference, we&apos;ll send you a private link. Check your spam folder too.</Callout> : <form className="flex flex-col gap-4" onSubmit={(event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); setError("");
    startTransition(async () => {
      try {
        const result = await requestManageLink({ makerspaceSlug: slug, reference: String(data.get("reference")), email: String(data.get("email")) });
        if (result.ok) setSent(true); else setError(result.error);
      } catch { setError("Could not request a booking link. Please try again."); }
    });
  }}><Field label="Booking email" required><Input name="email" type="email" autoComplete="email" maxLength={320} /></Field>
    <Field label="Booking reference" optional helperText="Leave blank to receive links for your recent bookings."><Input name="reference" placeholder="BK-123456" maxLength={32} /></Field>
    {error ? <Callout role="alert" tone="danger">{error}</Callout> : null}<Button type="submit" variant="accent" disabled={pending}>{pending ? "Requesting link…" : "Email me a booking link"}</Button>
  </form>;
}
