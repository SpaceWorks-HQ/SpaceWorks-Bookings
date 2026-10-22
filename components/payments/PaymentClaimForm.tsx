"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitPaymentClaim } from "@/app/actions/member-payments";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/choice";
import { Callout } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/field";

/** "I've paid": the member gives the UPI or bank reference so the team can match the transfer. */
export function PaymentClaimForm({ termId, payToken }: { termId: string; payToken?: string }) {
  const router = useRouter();
  const [method, setMethod] = useState<"upi" | "bank_transfer">("upi");
  const [utr, setUtr] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          setError(null);
          const result = await submitPaymentClaim({ termId, payToken, method, utr });
          if (!result.ok) setError(result.error);
          else router.refresh();
        });
      }}
    >
      {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
      <SegmentedControl<"upi" | "bank_transfer"> ariaLabel="How you paid" value={method} onValueChange={setMethod} options={[{ value: "upi", label: "UPI" }, { value: "bank_transfer", label: "Bank transfer" }]} size="sm" />
      <Field label={method === "upi" ? "UPI reference (UTR)" : "Transaction reference (UTR)"} helperText={method === "upi" ? "The 12-digit number in your UPI app's payment details." : "From your bank's confirmation."}>
        <Input value={utr} onChange={(event) => setUtr(event.target.value.trim())} maxLength={40} autoComplete="off" spellCheck={false} inputMode={method === "upi" ? "numeric" : "text"} />
      </Field>
      <div><Button type="submit" variant="secondary" loading={pending} disabled={utr.length < 6}>I&apos;ve paid</Button></div>
    </form>
  );
}
