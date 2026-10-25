# Tax on payments

How Space Works Bookings taxes payments and which document it issues. This follows the GST rules as
commonly applied to renting out space, but **it is not tax advice. Check your setup with your accountant.**

## Tax modes

Set per makerspace under **Settings → Payments and tax**. A payment freezes the settings it was created with
(`taxSnapshot`), so changing them never alters earlier receipts.

| Mode | Use it when | Document |
| --- | --- | --- |
| No tax | Not registered for any tax | Receipt ("This is a receipt, not a tax invoice.") |
| One tax rate | Outside India, e.g. VAT; any currency | Receipt showing the named tax |
| Indian GST | GST-registered; INR prices | See below |

### Indian GST

| Situation | Document | Tax |
| --- | --- | --- |
| Regular scheme, taxable | Tax invoice (issued at receipt, s.31(2)) | The chosen rate, default 18% |
| Composition scheme, or space rental exempt | Bill of supply (Rule 49) | None |
| Price in another currency, "export under LUT" | Tax invoice, zero-rated, with the LUT note | 0% |
| Price in another currency, "no GST" | Receipt | None |

SAC defaults to **997212** (rental or leasing of non-residential property); change it per makerspace if
your accountant advises another. The GSTIN's first two digits
must match the registered state.

## The maths

All amounts are integer minor units (paise for INR).

1. **Inclusive pricing** (the default): the listed price is the total. Taxable value =
   `round(price × 10000 / (10000 + rateBps))`; tax = price − taxable.
2. **Exclusive pricing**: taxable value = price; tax = `round(price × rateBps / 10000)`.
3. **Place of supply** is the customer's state recorded on the payment (`customerStateCode`), falling back to
   the supplier's state (IGST Act s.12(2)(b)). Phase 1 decides how bookings collect it; for immovable
   property the place of supply may be where the property is, so confirm this with your accountant.
4. **Same state** → CGST and SGST, two equal halves. If the tax is an odd number of paise, the extra paisa
   moves into the taxable value, so the halves match and the total never changes.
5. **Different state** → IGST, the whole tax.
6. Each charge item (the booking, an add-on) is its own line, taxed on its own.
7. **Credit notes** (refunds) share the refund across the original lines by amount, then each line's share
   across its taxable value and taxes, largest remainder first, so every column adds up exactly. A full refund
   reverses the invoice exactly.
8. A **mismatched gateway amount**, once accepted by the team, is re-apportioned the same way.

The functions are `resolveTaxSnapshot`, `splitTax`, `chargeLines`, `apportion` and `creditNoteLines` in
`lib/payments/tax.ts`, covered by `tests/unit/payments-tax.test.ts`.

## Numbering

One gapless series per makerspace per financial year (April–March by default, in the makerspace's
timezone) for receipts, tax invoices and bills of supply, and a second series for credit notes. Numbers are at
most 16 characters (Rule 46): an optional prefix of up to four letters or digits, the year, then a five-digit
sequence (`KUNJ-2627-00042`, `KUNJ-2627-C00007`). Allocation uses
`INSERT … ON CONFLICT … DO UPDATE … RETURNING` in the same transaction as the payment, so the first document of
a year needs no setup and concurrent payments never skip or repeat a number.

## What the documents show

Supplier name, legal name, address, state and GSTIN; recipient name, email, state and GSTIN when known;
place of supply; SAC; each line's taxable value, CGST and SGST (or IGST, or the named tax) and amount; totals;
how and when it was paid; and the notes the kind requires (LUT, bill of supply,
"computer-generated, no signature").

GSTR-1 and GSTR-3B style summaries are pure functions in `lib/reports/finance/` (`gst.ts`, `gstr1Json.ts`,
`documents.ts`); the report pages and exports that use them come in Phase 3.

## Booking payments

A booking's price already includes its tax (each line taxed at the space's or add-on's rate when it was priced,
frozen in the booking's price snapshot). A booking payment therefore uses that frozen snapshot made **inclusive**:
the amount the customer owes is split into taxable value and tax rather than taxed again, whatever the
makerspace's current inclusive/exclusive setting. A deposit, balance or difference is one `BOOKING` line at the
space's rate; the place of supply is where the space is (the supplier's state), so it is CGST + SGST.

Document kinds stay as above: a GST-registered makerspace issues a **tax invoice** for each booking payment, a bill
of supply under composition or exemption, otherwise a receipt; each processed refund gets a **credit note**. Strictly,
an advance taken before the booked time is a *receipt voucher* (Rule 50) and its refund a *refund voucher* (Rule 51),
with the tax invoice due when the space is used. That split is not built: it is listed under "Defaults chosen
conservatively" in `docs/DECISIONS.md` for the owner to decide with their accountant.
