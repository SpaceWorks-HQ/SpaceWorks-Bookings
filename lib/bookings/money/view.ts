import "server-only";

import { prisma } from "@/lib/db";
import type { MakerspaceAccessContext } from "@/lib/permissions";
import { can, makerspaceAllows, type Capability } from "@/lib/permissionRoles";
import { paymentPlan } from "./start";

/** The money side of a booking for the staff booking page (plain, serialisable data). */
export async function bookingMoneyView(access: MakerspaceAccessContext, bookingId: string) {
  const makerspaceId = access.makerspace.id;
  const allowed = (capability: Capability) => makerspaceAllows(access.makerspace.status, capability) && can(access.membership.role, capability);
  // Front desk records desk payments, so it sees this booking's own payments, never the Payments pages.
  const canView = allowed("payments.view") || allowed("payments.record");
  const booking = await prisma.booking.findFirstOrThrow({ where: { id: bookingId, makerspaceId } });
  const payments = canView ? await prisma.payment.findMany({
    where: { makerspaceId, bookingId }, orderBy: { createdAt: "asc" },
    select: { id: true, status: true, provider: true, method: true, purpose: true, amountMinor: true, capturedMinor: true, paidAt: true, createdAt: true, flagReason: true, flaggedAt: true, documents: { where: allowed("payments.view") ? {} : { id: "-" }, select: { id: true, number: true, kind: true } } },
  }) : [];
  const refunds = canView ? await prisma.refund.findMany({
    where: { makerspaceId, payment: { bookingId } }, orderBy: { createdAt: "asc" },
    select: { id: true, status: true, kind: true, amountMinor: true, reason: true, offlineRequired: true, sentAt: true, method: true, reference: true, failureReason: true, flagReason: true, flaggedAt: true, createdAt: true, processedAt: true, retry: { select: { id: true } }, document: { select: { id: true, number: true } } },
  }) : [];
  const plan = paymentPlan(booking, { full: true });
  const iso = (value: Date | null) => value?.toISOString() ?? null;
  return {
    canView,
    canRecord: allowed("payments.record"),
    canRefund: allowed("refunds.manage"),
    canChangeDue: allowed("bookings.manage"),
    dueMinor: plan?.amountMinor ?? 0,
    writtenOffAt: iso(booking.writtenOffAt),
    writtenOffReason: booking.writtenOffReason,
    concessionMinor: booking.concessionMinor,
    payments: payments.map((payment) => ({ ...payment, paidAt: iso(payment.paidAt), createdAt: payment.createdAt.toISOString(), flaggedAt: iso(payment.flaggedAt) })),
    refunds: refunds.map((refund) => ({
      ...refund, retried: Boolean(refund.retry), retry: undefined, sentAt: iso(refund.sentAt), flaggedAt: iso(refund.flaggedAt), createdAt: refund.createdAt.toISOString(), processedAt: iso(refund.processedAt),
      // A gateway refund nobody has sent yet can still be handed back offline instead.
      canRecordOffline: refund.status === "FAILED" ? !refund.retry : refund.status === "PENDING" && (refund.offlineRequired || !refund.sentAt),
    })),
  };
}

export type BookingMoneyView = Awaited<ReturnType<typeof bookingMoneyView>>;
