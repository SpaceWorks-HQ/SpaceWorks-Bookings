import { notFound } from "next/navigation";
import { payLinkTerm } from "@/lib/payments/memberAccess";
import { buildPayView } from "@/lib/payments/payView";

/** The pay page reached from a signed pay link, for organisations that don't use member accounts. */
export async function loadPayLinkView({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ payment?: string; cancelled?: string }> }) {
  const { token } = await params;
  const linked = await payLinkTerm(token);
  if (!linked) notFound();
  return { ...(await buildPayView(linked.term.id, linked.term.organisationId, await searchParams)), payToken: token };
}
