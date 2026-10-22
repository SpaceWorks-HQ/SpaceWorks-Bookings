import type { Metadata } from "next";
import { loadPayLinkView } from "@/lib/views/app__pay__token__page";
import { PayPageBody } from "@/components/payments/PayPageBody";

// The token is a payment capability: keep it out of search engines and Referer headers.
export const metadata: Metadata = { title: "Pay for your membership", robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ payment?: string; cancelled?: string }> };

export default async function PayLinkPage({ params, searchParams }: Props) {
  const view = await loadPayLinkView({ params, searchParams });
  return (
    <main id="main-content" className="mx-auto w-full max-w-[760px] px-4 py-10 sm:px-6">
      <PayPageBody view={view} payToken={view.payToken} />
    </main>
  );
}
