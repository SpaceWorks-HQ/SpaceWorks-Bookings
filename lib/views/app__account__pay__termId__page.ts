import { notFound } from "next/navigation";
import { ownTerm } from "@/lib/payments/memberAccess";
import { buildPayView } from "@/lib/payments/payView";

/**
 * The member's pay page for one membership: what is due (with tax), whether it is already paid or being
 * checked, and every way to pay. Returning from Stripe with ?payment= settles the attempt straight away.
 */
export async function loadPayView({ params, searchParams }: { params: Promise<{ termId: string }>; searchParams: Promise<{ payment?: string; cancelled?: string }> }) {
  const { termId } = await params;
  const own = await ownTerm(termId);
  if (!own) notFound();
  return buildPayView(termId, own.term.organisationId, await searchParams);
}
