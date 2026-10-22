"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addLedgerEntry } from "@/app/actions/accounts";
import { LEDGER_METHOD_LABELS, PAYMENT_CATEGORIES, RECEIPT_CATEGORIES, type LedgerMethod } from "@/lib/accounts/categories";
import { parseAmount, type CurrencyCode } from "@/lib/money/currencies";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Dropdown, Field, Input, Textarea } from "@/components/ui/field";

type Direction = "RECEIPT" | "PAYMENT";

/** Record money received (a donation, a grant) or paid out (rent, equipment) outside membership payments. */
export function LedgerEntryDialog({ slug, direction, currencies, today, onClose }: { slug: string; direction: Direction; currencies: string[]; today: string; onClose: (saved: boolean) => void }) {
  const router = useRouter();
  const [values, setValues] = useState({ occurredOn: today, category: "", party: "", description: "", currency: currencies[0] ?? "INR", amount: "", method: "bank_transfer" as LedgerMethod, reference: "" });
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => setValues((current) => ({ ...current, [key]: value }));
  const amountMinor = parseAmount(values.amount, values.currency as CurrencyCode);
  const receipt = direction === "RECEIPT";

  const save = () =>
    startTransition(async () => {
      setError(null);
      const result = await addLedgerEntry({ organisationSlug: slug, direction, ...values, amountMinor: amountMinor ?? 0 });
      if (!result.ok) {
        setError(result.error);
        setErrors(result.fieldErrors ?? {});
        return;
      }
      router.refresh();
      onClose(true);
    });

  return (
    <Dialog open onOpenChange={(open) => (!open && !pending ? onClose(false) : undefined)}>
      <DialogContent size="md">
        <DialogHeader title={receipt ? "Record money received" : "Record a payment"} description={receipt ? "Donations, grants, sponsorship and other money that isn't a membership fee." : "Rent, equipment, events and everything else the organisation pays for."} />
        <DialogBody className="flex flex-col gap-4">
          {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Date" error={errors.occurredOn?.[0]}><Input type="date" value={values.occurredOn} max={today} onChange={(event) => set("occurredOn", event.target.value)} /></Field>
            <Field label="Category" helperText="Pick one or type your own." error={errors.category?.[0]}>
              <Input list={`ledger-categories-${direction}`} value={values.category} onChange={(event) => set("category", event.target.value)} maxLength={60} />
            </Field>
            <datalist id={`ledger-categories-${direction}`}>{(receipt ? RECEIPT_CATEGORIES : PAYMENT_CATEGORIES).map((category) => <option key={category} value={category} />)}</datalist>
            <Field label="Amount" error={errors.amountMinor?.[0] ?? (values.amount && !amountMinor ? "Enter an amount" : undefined)}>
              <Input inputMode="decimal" value={values.amount} onChange={(event) => set("amount", event.target.value)} />
            </Field>
            <Field label="Currency">
              <Dropdown value={values.currency} onChange={(event) => set("currency", event.target.value)}>
                {currencies.map((code) => <option key={code} value={code}>{code}</option>)}
              </Dropdown>
            </Field>
            <Field label={receipt ? "Received from" : "Paid to"} optional error={errors.party?.[0]}><Input value={values.party} onChange={(event) => set("party", event.target.value)} maxLength={120} /></Field>
            <Field label="How" helperText="Cash changes cash in hand; everything else the bank.">
              <Dropdown value={values.method} onChange={(event) => set("method", event.target.value as LedgerMethod)}>
                {Object.entries(LEDGER_METHOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Dropdown>
            </Field>
          </div>
          <Field label="Reference" optional helperText="Bill number, cheque number or UTR."><Input value={values.reference} onChange={(event) => set("reference", event.target.value)} maxLength={80} /></Field>
          <Field label="Note" optional><Textarea value={values.description} onChange={(event) => set("description", event.target.value)} rows={2} maxLength={300} /></Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" disabled={pending} onClick={() => onClose(false)}>Cancel</Button>
          <Button variant="primary" loading={pending} disabled={!amountMinor || !values.category.trim()} onClick={save}>{receipt ? "Record receipt" : "Record payment"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
