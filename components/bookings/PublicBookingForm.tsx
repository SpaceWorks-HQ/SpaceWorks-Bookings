"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AddOn } from "@prisma/client";
import { createHold, previewQuote, releaseHold, submitBooking } from "@/app/actions/bookings-public";
import { previewBookingConflicts } from "@/app/actions/booking-availability";
import type { BookingRules } from "@/lib/bookingRules/schema";
import type { Quote } from "@/lib/pricing/quote";
import { payLaterOffered } from "@/lib/bookings/paymentDue";
import { money } from "@/lib/money/currencies";
import { words } from "@/lib/bookings/ui";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { Field, Input, Textarea } from "@/components/ui/field";
import { CheckboxField } from "@/components/ui/choice";
import { AvailabilityPicker, type TimeChoice } from "./AvailabilityPicker";
import { RecurrenceFields, type RepeatChoice } from "./RecurrenceFields";
import { QuoteSummary } from "./QuoteSummary";

type Props = { slug: string; spaceId: string; zone: string; today: string; units: number; capacity: number; rules: BookingRules; addOns: AddOn[]; currency: string; contact: { name: string; email: string } };
export function PublicBookingForm(props: Props) {
  const { slug, spaceId, zone, today, units, rules, addOns, currency } = props;
  const router = useRouter();
  const [choice, setChoice] = useState<TimeChoice | null>(null);
  const [repeat, setRepeat] = useState<RepeatChoice>(null);
  const [skip, setSkip] = useState(false);
  const [attendees, setAttendees] = useState(1);
  const [extras, setExtras] = useState<Record<string, number>>({});
  const [quote, setQuote] = useState<Quote | null>(null);
  const [conflicts, setConflicts] = useState<Array<{ date: string; reasons: string[] }>>([]);
  const [error, setError] = useState("");
  const [quoteMessage, setQuoteMessage] = useState("Choose a time to see the price.");
  const [pending, startTransition] = useTransition();
  const held = useRef<{ key: string; bookingId: string; manageToken: string; holdExpiresAt: number } | null>(null);
  const [owner, setOwner] = useState<{ bookingId: string; manageToken: string; holdExpiresAt: number } | undefined>();
  const dropHold = useCallback(() => { held.current = null; setOwner(undefined); }, []);
  useEffect(() => {
    if (!owner) return;
    const timer = setTimeout(dropHold, Math.max(0, owner.holdExpiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [owner, dropHold]);
  function changeSelection(change: () => void) {
    startTransition(async () => {
      const cached = held.current;
      if (cached && cached.holdExpiresAt <= Date.now()) dropHold();
      else if (cached) {
        try {
          const result = await releaseHold({ makerspaceSlug: slug, bookingId: cached.bookingId, manageToken: cached.manageToken });
          if (!result.ok && result.code !== "HOLD_GONE") { setError(result.error); return; }
        } catch { setError("Could not release your hold. Please try again."); return; }
        dropHold();
      }
      change();
    });
  }
  const selections = Object.entries(extras).filter(([, quantity]) => quantity > 0).map(([addOnId, quantity]) => ({ addOnId, quantity }));
  const inputKey = JSON.stringify(choice ? { makerspaceSlug: slug, spaceId, ...choice, recurrence: repeat, skipConflicts: skip, attendees, addOns: selections } : null);
  const [quotedKey, setQuotedKey] = useState("");
  useEffect(() => {
    let stale = false;
    const timer = setTimeout(async () => {
      const input = JSON.parse(inputKey);
      if (!input) { setQuote(null); setConflicts([]); setQuoteMessage("Choose a time to see the price."); return; }
      if (owner && owner.holdExpiresAt <= Date.now()) { dropHold(); return; }
      if (owner) Object.assign(input, { bookingId: owner.bookingId, manageToken: owner.manageToken });
      try {
        const result = await previewBookingConflicts(input);
        if (stale) return;
        if (!result.ok) { if (result.code === "HOLD_GONE") dropHold(); setQuote(null); setConflicts([]); setQuotedKey(inputKey); setQuoteMessage(result.error); return; }
        if (!result.data) return;
        setConflicts(result.data.conflicts);
        if (result.data.conflicts.length && !input.skipConflicts) { setQuote(null); setQuotedKey(inputKey); setQuoteMessage("Review the conflicting dates below."); return; }
        if (owner && owner.holdExpiresAt <= Date.now()) { dropHold(); return; }
        const price = await previewQuote(input);
        if (stale) return;
        if (!price.ok && price.code === "HOLD_GONE") dropHold();
        setQuote(price.ok ? price.data ?? null : null); setQuotedKey(inputKey);
        setQuoteMessage(price.ok ? `${result.data.availableCount} booking time${result.data.availableCount === 1 ? "" : "s"}. Prices include the tax shown below.` : price.error);
      } catch { if (!stale) { setQuote(null); setQuotedKey(inputKey); setQuoteMessage("Could not load the quote. Please try again."); } }
    }, 350);
    return () => { stale = true; clearTimeout(timer); };
  }, [inputKey, owner, dropHold]);
  const canPayLater = choice && (rules.chargeMode === "PAY_NOW" || rules.chargeMode === "DEPOSIT") && rules.allowPayLater && payLaterOffered(rules, new Date(choice.start), new Date());
  return <form onSubmit={(event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    if (!choice || !quote || quotedKey !== inputKey) return;
    setError("");
    startTransition(async () => {
      try {
        const holdInput = { makerspaceSlug: slug, spaceId, ...choice, recurrence: repeat, skipConflicts: skip };
        const key = JSON.stringify(holdInput);
        if (held.current && held.current.holdExpiresAt <= Date.now()) dropHold();
        if (held.current?.key !== key) {
          if (held.current) {
            const released = await releaseHold({ makerspaceSlug: slug, bookingId: held.current.bookingId, manageToken: held.current.manageToken });
            if (!released.ok && released.code !== "HOLD_GONE") { setError(released.error); return; }
            dropHold();
          }
          const hold = await createHold(holdInput);
          if (!hold.ok) { setError(hold.error); return; }
          if (!hold.data) return;
          const credentials = { bookingId: hold.data.bookingId, manageToken: hold.data.manageToken, holdExpiresAt: new Date(hold.data.holdExpiresAt).getTime() };
          held.current = { key, ...credentials };
          setOwner(credentials);
        }
        if (!held.current || held.current.holdExpiresAt <= Date.now()) { dropHold(); setError("Your hold has expired. Please try again."); return; }
        const result = await submitBooking({ makerspaceSlug: slug, bookingId: held.current.bookingId, manageToken: held.current.manageToken,
          contact: { name: String(form.get("name")), email: String(form.get("email")), phone: String(form.get("phone")) }, attendees,
          addOns: selections, purpose: String(form.get("purpose")), payLater: Boolean(canPayLater && form.get("payLater")) });
        if (!result.ok) { if (result.code === "HOLD_GONE") dropHold(); setError(result.error + (result.fieldErrors ? ` ${Object.values(result.fieldErrors).flat().join(" ")}` : "")); return; }
        if (!result.data) return;
        dropHold();
        router.push(`/m/${slug}/bookings/${result.data.reference}?t=${encodeURIComponent(result.data.manageToken)}`);
      } catch { setError("Could not submit your booking. Please try again."); }
    });
  }} className="flex flex-col gap-6">
    <fieldset disabled={pending} className="flex flex-col gap-6">
      <AvailabilityPicker slug={slug} spaceId={spaceId} zone={zone} today={today} units={units} rules={rules} owner={owner} onHoldGone={dropHold} onChange={(value) => changeSelection(() => { setChoice(value); setSkip(false); })} />
      <RecurrenceFields value={repeat} onChange={(value) => changeSelection(() => { setRepeat(value); setSkip(false); })} max={rules.recurrenceMaxOccurrences} today={today} />
      {conflicts.length ? <Callout tone="warning" title="These dates are unavailable"><ul>{conflicts.map((item, index) => <li key={index}>{item.date}: {item.reasons.join(" ")}</li>)}</ul>
        <CheckboxField className="mt-3" checked={skip} onCheckedChange={(value) => changeSelection(() => setSkip(value === true))} label="Skip these dates and book the remaining times" /></Callout> : null}
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Name" required><Input name="name" autoComplete="name" defaultValue={props.contact.name} maxLength={200} /></Field>
        <Field label="Email" required><Input name="email" type="email" autoComplete="email" defaultValue={props.contact.email} maxLength={320} /></Field>
        <Field label="Phone" optional><Input name="phone" type="tel" autoComplete="tel" maxLength={40} /></Field>
        <Field label="Attendees" required><Input type="number" min={1} max={props.capacity > 0 ? Math.min(100_000, props.capacity * (choice?.quantity ?? 1)) : 100_000} value={attendees} onChange={(event) => setAttendees(Number(event.target.value))} /></Field></div>
      <Field label="Purpose" optional><Textarea name="purpose" maxLength={2000} /></Field>
      {addOns.length ? <fieldset className="flex flex-col gap-4"><legend className="mb-3 text-h3">Add-ons</legend>{addOns.map((extra) => <Field key={extra.id} label={`${extra.name} · ${money(extra.priceMinor, currency)} · ${words(extra.unit)}`} helperText={extra.description || undefined}>
        <Input type="number" min={0} max={100} value={extras[extra.id] ?? 0} onChange={(event) => setExtras({ ...extras, [extra.id]: Number(event.target.value) })} /></Field>)}</fieldset> : null}
      {canPayLater ? <CheckboxField name="payLater" label="Pay later" /> : null}
      {rules.chargeMode === "PAY_LATER" ? <p>Payment is due by the date shown on your confirmation.</p> : null}
      <p role="status">{quotedKey !== inputKey && choice ? "Updating quote…" : quoteMessage}</p>
      {quote && quotedKey === inputKey ? <QuoteSummary quote={quote} /> : null}
      {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
      <Button type="submit" variant="accent" disabled={!quote || quotedKey !== inputKey || pending}>{pending ? "Submitting booking…" : rules.approvalMode === "APPROVAL" ? "Request booking" : "Book this space"}</Button>
    </fieldset>
  </form>;
}
