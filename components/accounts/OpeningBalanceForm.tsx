"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setOpeningBalance } from "@/app/actions/accounts";
import { parseAmount, toInputValue, type CurrencyCode } from "@/lib/money/currencies";
import { Button } from "@/components/ui/button";
import { Callout, Card, CardHeader } from "@/components/ui/display";
import { Dropdown, Field, Input } from "@/components/ui/field";

type Opening = { currency: string; cashMinor: number; bankMinor: number };

/** Cash in hand and at the bank on the first day of the year, carried forward from last year's accounts. */
export function OpeningBalanceForm({ slug, year, currencies, openings }: { slug: string; year: string; currencies: string[]; openings: Opening[] }) {
  const router = useRouter();
  const [currency, setCurrency] = useState(currencies[0] ?? "INR");
  const current = openings.find((row) => row.currency === currency);
  const code = currency as CurrencyCode;
  const [cash, setCash] = useState(current ? toInputValue(current.cashMinor, code) : "");
  const [bank, setBank] = useState(current ? toInputValue(current.bankMinor, code) : "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const read = (value: string) => (value.trim() === "" ? 0 : parseAmount(value, code));

  return (
    <Card as="section" className="rounded-xl">
      <CardHeader title="Opening balance" description={`Cash in hand and at the bank on the first day of FY ${year}.`} />
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const cashMinor = read(cash);
          const bankMinor = read(bank);
          if (cashMinor === null || bankMinor === null) return setMessage({ ok: false, text: "Enter amounts like 1500 or 1500.50." });
          startTransition(async () => {
            const result = await setOpeningBalance({ organisationSlug: slug, financialYear: year, currency, cashMinor, bankMinor });
            setMessage(result.ok ? { ok: true, text: "Saved." } : { ok: false, text: result.error });
            router.refresh();
          });
        }}
      >
        {message ? <Callout tone={message.ok ? "success" : "danger"} role={message.ok ? "status" : "alert"}>{message.text}</Callout> : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Currency">
            <Dropdown value={currency} onChange={(event) => {
              const next = event.target.value;
              const row = openings.find((item) => item.currency === next);
              setCurrency(next);
              setCash(row ? toInputValue(row.cashMinor, next as CurrencyCode) : "");
              setBank(row ? toInputValue(row.bankMinor, next as CurrencyCode) : "");
            }}>
              {currencies.map((item) => <option key={item} value={item}>{item}</option>)}
            </Dropdown>
          </Field>
          <Field label="Cash in hand"><Input inputMode="decimal" value={cash} onChange={(event) => setCash(event.target.value)} placeholder="0" /></Field>
          <Field label="At the bank"><Input inputMode="decimal" value={bank} onChange={(event) => setBank(event.target.value)} placeholder="0" /></Field>
        </div>
        <div><Button type="submit" variant="secondary" loading={pending}>Save opening balance</Button></div>
      </form>
    </Card>
  );
}
