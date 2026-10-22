# Tax on membership payments

How Space Works Bookings taxes payments and which document it issues. This follows the GST rules as
commonly applied to membership fees, but **it is not tax advice. Check your setup with your accountant.**

## Tax modes

Set per makerspace under **Settings → Payments and tax**. A payment freezes the settings it was created with
(`taxSnapshot`), so changing them never alters earlier receipts.

| Mode | Use it when | Document |
| --- | --- | --- |
| No tax | Not registered for any tax | Receipt ("This is a receipt, not a tax invoice.") |
| One tax rate | Outside India, e.g. VAT; any currency | Receipt showing the named tax |
| Indian GST | GST-registered; INR plans | See below |

### Indian GST

| Situation | Document | Tax |
| --- | --- | --- |
| Regular scheme, taxable | Tax invoice (issued at receipt, s.31(2)) | The chosen rate, default 18% |
| Composition scheme, or membership exempt | Bill of supply (Rule 49) | None |
| Plan in another currency, "export under LUT" | Tax invoice, zero-rated, with the LUT note | 0% |
| Plan in another currency, "no GST" | Receipt | None |

SAC defaults to **999599** (services provided by other membership makerspaces). The GSTIN's first two digits
must match the registered state.

## The maths

All amounts are integer minor units (paise for INR).

1. **Inclusive pricing** (the default): the plan price is the total. Taxable value =
   `round(price × 10000 / (10000 + rateBps))`; tax = price − taxable.
2. **Exclusive pricing**: taxable value = price; tax = `round(price × rateBps / 10000)`.
3. **Place of supply** is the member's state, falling back to the supplier's state
   (IGST Act s.12(2)(b)).
4. **Same state** → CGST and SGST, two equal halves. If the tax is an odd number of paise, the extra paisa
   moves into the taxable value, so the halves match and the total never changes.
5. **Different state** → IGST, the whole tax.
6. The term fee and the joining (or rejoining) fee are separate lines, each taxed on its own.
7. **Credit notes** (refunds) share the refund across the original lines by amount, then each line's share
   across its taxable value and taxes, largest remainder first, so every column adds up exactly. A full refund
   reverses the invoice exactly.
8. A **mismatched gateway amount**, once accepted by a manager, is re-apportioned the same way.

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

Supplier name, legal name, address, state and GSTIN; recipient name, member number, state and GSTIN when known;
place of supply; SAC; each line's taxable value, CGST and SGST (or IGST, or the named tax) and amount; totals;
how and when it was paid; the membership period; and the notes the kind requires (LUT, bill of supply,
"computer-generated, no signature").

GSTR-1 and GSTR-3B style summaries are in the finance reports (see [REPORTS.md](REPORTS.md)).
