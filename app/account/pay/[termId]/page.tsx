import type { Metadata } from "next";
import { loadPayView } from "@/lib/views/app__account__pay__termId__page";
import { PayPageBody } from "@/components/payments/PayPageBody";

export const metadata: Metadata = { title: "Pay for your membership", robots: { index: false, follow: false } };

type Props = { params: Promise<{ termId: string }>; searchParams: Promise<{ payment?: string; cancelled?: string }> };

export default async function PayPage({ params, searchParams }: Props) {
  return <PayPageBody view={await loadPayView({ params, searchParams })} />;
}
