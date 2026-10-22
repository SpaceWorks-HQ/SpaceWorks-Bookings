"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmMemberRazorpay, startMemberCheckout } from "@/app/actions/member-payments";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";

type RazorpayResponse = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
type RazorpayInstance = { open(): void; on(event: string, handler: (response: { error?: { description?: string } }) => void): void };
type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance;

const SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

/** Load Checkout.js once. Under the page's strict-dynamic CSP a script added by our own code is trusted. */
function loadRazorpay(): Promise<RazorpayConstructor> {
  const existing = (window as unknown as { Razorpay?: RazorpayConstructor }).Razorpay;
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => {
      const loaded = (window as unknown as { Razorpay?: RazorpayConstructor }).Razorpay;
      if (loaded) resolve(loaded);
      else reject(new Error("Razorpay did not load"));
    };
    script.onerror = () => reject(new Error("Razorpay did not load"));
    document.head.appendChild(script);
  });
}

/** Pay online: Razorpay opens over the page; Stripe sends the member to its own checkout and back. */
export function OnlinePayButton({ termId, payToken, label, organisationName, description }: { termId: string; payToken?: string; label: string; organisationName: string; description: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const pay = () =>
    startTransition(async () => {
      setError(null);
      setNote(null);
      const result = await startMemberCheckout({ termId, payToken });
      if (!result.ok || !result.data) {
        setError(result.ok ? "Couldn't start the payment." : result.error);
        return;
      }
      const checkout = result.data;
      if (checkout.kind === "redirect") {
        window.location.assign(checkout.url);
        return;
      }
      try {
        const Razorpay = await loadRazorpay();
        const instance = new Razorpay({
          key: checkout.keyId,
          order_id: checkout.orderId,
          amount: checkout.amountMinor,
          currency: checkout.currency,
          name: organisationName,
          description,
          prefill: { name: checkout.name, email: checkout.email },
          // The brand accent (tokens.css --sw-color-accent), so the Razorpay sheet matches our buttons.
          theme: { color: "#006E63" },
          modal: { ondismiss: () => setNote("Payment window closed. Nothing was charged unless you finished paying.") },
          handler: (response: RazorpayResponse) => {
            startTransition(async () => {
              const confirmed = await confirmMemberRazorpay({ payToken, paymentId: checkout.paymentId, orderId: response.razorpay_order_id, gatewayPaymentId: response.razorpay_payment_id, signature: response.razorpay_signature });
              if (!confirmed.ok) setError(confirmed.error);
              else if (confirmed.data?.status !== "PAID") setNote("Payment received by Razorpay. It will show here within a few minutes.");
              router.refresh();
            });
          },
        });
        instance.on("payment.failed", (failure) => setError(failure.error?.description ?? "The payment didn't go through. You can try again."));
        instance.open();
      } catch {
        setError("Razorpay couldn't load. Check your connection, or use one of the other ways to pay below.");
      }
    });

  return (
    <div className="flex flex-col gap-3">
      {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
      {note ? <Callout tone="info" role="status">{note}</Callout> : null}
      <div><Button variant="accent" size="lg" loading={pending} onClick={pay}>{label}</Button></div>
    </div>
  );
}
