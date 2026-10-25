import type { Quote } from "@/lib/pricing/quote";
import { quoteDisplay } from "@/lib/bookings/publicUi";
import { money } from "@/lib/money/currencies";

export function QuoteSummary({ quote }: { quote: Quote }) {
  const view = quoteDisplay(quote);
  return <section aria-label="Price quote" className="rounded-xl border border-line p-4">
    <h3 className="text-h3">Your quote</h3>{view.memberLabel ? <p className="text-accent-text">{view.memberLabel}</p> : null}
    <ul className="my-4 flex flex-col gap-3">{view.lines.map((line, index) => <li key={index} className="flex justify-between gap-4"><span>{line.description}<small className="block text-caption text-ink-secondary">{line.detail}</small></span><span className="shrink-0">{money(line.amountMinor, quote.currency)}</span></li>)}</ul>
    <dl className="border-t border-line pt-3"><div className="flex justify-between"><dt>Subtotal</dt><dd>{money(view.subtotalMinor, quote.currency)}</dd></div>
      <div className="flex justify-between"><dt>Tax</dt><dd>{money(view.taxMinor, quote.currency)}</dd></div>
      <div className="flex justify-between font-semibold"><dt>Total</dt><dd>{money(view.totalMinor, quote.currency)}</dd></div></dl>
  </section>;
}
