"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordPayment, waiveFee } from "@/app/actions/payments";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Dropdown, Field, Input, Textarea } from "@/components/ui/field";
import { OFFLINE_METHOD_LABELS, type OfflineMethod } from "@/lib/payments/offline-methods";

export type DueItem = { termId: string; planName: string; amount: string };

/** Record money received outside the gateway, or waive the fee, for one membership. */
export function RecordPaymentDialog({ slug, due, mode, makerChecker, onClose }: { slug: string; due: DueItem; mode: "record" | "waive"; makerChecker: boolean; onClose: (message?: string) => void }) {
  const router = useRouter();
  const [method, setMethod] = useState<OfflineMethod>("upi");
  const [utr, setUtr] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [pending, startTransition] = useTransition();
  const needsUtr = method === "upi" || method === "bank_transfer";

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const result = mode === "waive"
        ? await waiveFee({ organisationSlug: slug, termId: due.termId, reason: note })
        : await recordPayment({ organisationSlug: slug, termId: due.termId, method, utr: needsUtr ? utr : null, reference: needsUtr ? null : reference, note });
      if (!result.ok) {
        setError(result.error);
        setErrors(result.fieldErrors ?? {});
        return;
      }
      router.refresh();
      const settled = mode === "record" && result.ok && "data" in result && (result.data as { settled?: boolean } | undefined)?.settled;
      onClose(mode === "waive" ? "Fee waived. The membership has started." : settled ? "Payment recorded and receipted." : "Payment recorded. Someone else on the team needs to confirm it.");
    });

  return (
    <Dialog open onOpenChange={(open) => (!open && !pending ? onClose() : undefined)}>
      <DialogContent size="sm">
        <DialogHeader
          title={mode === "waive" ? `Waive ${due.amount}?` : `Record ${due.amount}`}
          description={mode === "waive" ? `${due.planName}: the membership starts without a payment. Nothing is receipted.` : `${due.planName}${makerChecker ? ". A second person confirms it before it's receipted." : ". It's receipted straight away."}`}
        />
        <DialogBody className="flex flex-col gap-4">
          {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
          {mode === "record" ? (
            <>
              <Field label="How it was paid">
                <Dropdown value={method} onChange={(event) => setMethod(event.target.value as OfflineMethod)}>
                  {Object.entries(OFFLINE_METHOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Dropdown>
              </Field>
              {needsUtr ? (
                <Field label={method === "upi" ? "UPI reference (UTR)" : "Bank reference (UTR)"} helperText="Checked so the same transfer isn't recorded twice." error={errors.utr?.[0]}>
                  <Input value={utr} onChange={(event) => setUtr(event.target.value)} maxLength={40} autoComplete="off" spellCheck={false} />
                </Field>
              ) : (
                <Field label="Reference" optional helperText="Receipt book number, cheque number or similar." error={errors.reference?.[0]}>
                  <Input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={80} />
                </Field>
              )}
            </>
          ) : null}
          <Field label={mode === "waive" ? "Reason" : "Note"} optional={mode === "record"} error={errors.reason?.[0] ?? errors.note?.[0]}>
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={300} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onClose()} disabled={pending}>Cancel</Button>
          <Button variant={mode === "waive" ? "secondary" : "primary"} loading={pending} onClick={submit} disabled={mode === "waive" ? note.trim().length < 3 : needsUtr && utr.trim().length < 6}>
            {mode === "waive" ? "Waive fee" : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
