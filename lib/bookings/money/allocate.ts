/**
 * Split one booking refund over the booking's payments (pure). Payments the gateway can still refund go first,
 * newest first, so the customer gets money back the way they paid; then the rest, newest first, as refunds a
 * person hands back offline (cash, bank transfer, or a gateway that is no longer connected).
 */

export type RefundSource = {
  paymentId: string;
  paidAt: Date;
  /** What is left to refund on this payment. */
  refundableMinor: number;
  /** The connected gateway can refund it (same provider, with its payment id). */
  gatewayUsable: boolean;
};

export type RefundPart = { paymentId: string; amountMinor: number; offlineRequired: boolean };

export class RefundAllocationError extends Error {
  override name = "RefundAllocationError";
}

export function allocateRefund(amountMinor: number, sources: RefundSource[]): RefundPart[] {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) return [];
  const available = sources.reduce((sum, source) => sum + Math.max(0, source.refundableMinor), 0);
  if (amountMinor > available) throw new RefundAllocationError("That's more than was paid and is left to refund.");
  const ordered = [...sources]
    .filter((source) => source.refundableMinor > 0)
    .sort((a, b) => Number(b.gatewayUsable) - Number(a.gatewayUsable) || b.paidAt.getTime() - a.paidAt.getTime() || (a.paymentId < b.paymentId ? 1 : -1));
  const parts: RefundPart[] = [];
  let left = amountMinor;
  for (const source of ordered) {
    if (left === 0) break;
    const take = Math.min(left, source.refundableMinor);
    parts.push({ paymentId: source.paymentId, amountMinor: take, offlineRequired: !source.gatewayUsable });
    left -= take;
  }
  return parts;
}
