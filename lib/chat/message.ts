import "server-only";

import { prisma } from "@/lib/db";
import { money } from "@/lib/money/currencies";
import { absoluteUrl } from "@/lib/email/message";
import type { ChatEvent } from "./events";

export type ChatRefs = { paymentId?: string };

/**
 * The plain-text alert for one event, built when it is sent from ids only, so nothing personal sits in the
 * queue. Null when the record has gone (the alert is dropped). Names appear only when the channel allows.
 */
export async function chatMessage(makerspaceId: string, event: ChatEvent, refs: ChatRefs, includeNames: boolean): Promise<string | null> {
  const makerspace = await prisma.makerspace.findUnique({ where: { id: makerspaceId }, select: { name: true, slug: true, locale: true } });
  if (!makerspace) return null;
  const base = `/dashboard/${makerspace.slug}`;
  const line = (text: string, path: string) => `${makerspace.name}: ${text}\n${absoluteUrl(path)}`;

  if ((event === "payment" || event === "payment-to-confirm") && refs.paymentId) {
    const payment = await prisma.payment.findFirst({ where: { id: refs.paymentId, makerspaceId }, select: { amountMinor: true, currency: true, customerName: true } });
    if (!payment) return null;
    const what = `${money(payment.amountMinor, payment.currency, makerspace.locale)}${includeNames ? ` from ${payment.customerName}` : ""}`;
    return event === "payment"
      ? line(`payment received: ${what}.`, `${base}/payments/${refs.paymentId}`)
      : line(`payment waiting to be confirmed: ${what}. Confirm it:`, `${base}/payments/${refs.paymentId}`);
  }
  return null;
}
