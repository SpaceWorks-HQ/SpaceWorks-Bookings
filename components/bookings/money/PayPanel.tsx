"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { confirmBookingRazorpay, refreshBookingPayment, startBookingPayment } from "@/app/actions/booking-payments";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { useToast } from "@/components/feedback/ToastProvider";
import { money } from "@/lib/money/currencies";

type RazorpayHandlerResponse = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
type RazorpayInstance = { open(): void; on(event: string, handler: () => void): void };
declare global { interface Window { Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance } }

/** Razorpay Checkout is loaded only when a customer pays (its frame is allowed on booking pages). */
function loadRazorpay(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export type PayPanelPayment = {
  plan: { amountMinor: number; purpose: string } | null; fullAmountMinor: number | null; online: string | null;
  upiVpa: string | null; upiPayeeName: string | null; offlineInstructions: string;
};

export function PayPanel({ slug, bookingId, manageToken, currency, makerspaceName, payment, dueText }: {
  slug: string; bookingId: string; manageToken?: string; currency: string; makerspaceName: string; payment: PayPanelPayment; dueText: string | null;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const { showToast } = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const checked = useRef(false);
  const scope = { makerspaceSlug: slug, bookingId, ...(manageToken ? { manageToken } : {}) };

  // Back from Stripe Checkout: ask the provider where the payment stands, once.
  useEffect(() => {
    const paymentId = search.get("payment");
    if (!paymentId || checked.current) return;
    checked.current = true;
    start(async () => {
      const result = await refreshBookingPayment({ ...scope, paymentId });
      if (result.ok && result.data?.status === "PAID") showToast("Payment received. Thank you.", "success");
      else if (result.ok) showToast("Your payment is being confirmed. This page updates once it arrives.", "info");
      router.refresh();
    });
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!payment.plan) return null;
  const plan = payment.plan;
  const pay = (full: boolean) => start(async () => {
    setError(null);
    const result = await startBookingPayment({ ...scope, full });
    if (!result.ok || !result.data) { setError(result.ok ? "Could not start the payment. Please try again." : result.error); return; }
    const checkout = result.data;
    if (checkout.kind === "redirect") { window.location.assign(checkout.url); return; }
    if (!(await loadRazorpay()) || !window.Razorpay) { setError("The payment window couldn't load. Check your connection and try again."); return; }
    const razorpay = new window.Razorpay({
      key: checkout.keyId, order_id: checkout.orderId, amount: checkout.amountMinor, currency: checkout.currency, name: makerspaceName,
      description: `Booking ${checkout.reference}`, prefill: { name: checkout.customer.name, email: checkout.customer.email }, timeout: 900,
      notes: { paymentId: checkout.paymentId },
      handler: (response: RazorpayHandlerResponse) => start(async () => {
        const confirmed = await confirmBookingRazorpay({ ...scope, paymentId: checkout.paymentId, orderId: response.razorpay_order_id, gatewayPaymentId: response.razorpay_payment_id, signature: response.razorpay_signature });
        if (!confirmed.ok) setError(confirmed.error);
        else showToast(confirmed.data?.status === "PAID" ? "Payment received. Thank you." : "Your payment is being confirmed.", "success");
        router.refresh();
      }),
    });
    razorpay.on("payment.failed", () => setError("The payment didn't go through. Nothing was taken; you can try again."));
    razorpay.open();
  });

  const label = plan.purpose === "DEPOSIT" ? `Pay the deposit, ${money(plan.amountMinor, currency)}` : `Pay ${money(plan.amountMinor, currency)}`;
  return <section className="flex flex-col gap-3" aria-labelledby="pay-heading">
    <h2 id="pay-heading" className="text-h2">Payment</h2>
    {dueText ? <p className="text-ink-secondary">{dueText}</p> : null}
    {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
    {payment.online ? <div className="flex flex-wrap gap-3">
      <Button onClick={() => pay(false)} loading={pending}>{label}</Button>
      {payment.fullAmountMinor ? <Button variant="secondary" onClick={() => pay(true)} disabled={pending}>Pay all {money(payment.fullAmountMinor, currency)}</Button> : null}
    </div> : null}
    {payment.upiVpa || payment.offlineInstructions || !payment.online ? <Callout title={payment.online ? "Other ways to pay" : "How to pay"}>
      {payment.upiVpa ? <span className="block">UPI: {payment.upiVpa}{payment.upiPayeeName ? ` (${payment.upiPayeeName})` : ""}</span> : null}
      {payment.offlineInstructions ? <span className="block whitespace-pre-wrap">{payment.offlineInstructions}</span> : null}
      {!payment.online && !payment.upiVpa && !payment.offlineInstructions ? <span className="block">Pay {makerspaceName} at the desk or contact them using the details below.</span> : null}
      <span className="block">Quote your booking reference so the team can match the payment.</span>
    </Callout> : null}
  </section>;
}
