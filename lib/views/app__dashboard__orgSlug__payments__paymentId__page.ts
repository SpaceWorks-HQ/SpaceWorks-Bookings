import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { can, requireOrgCapability } from "@/lib/permissions";

/** One payment: lines, documents, refunds and who recorded or confirmed it. */
export async function loadPaymentView({ params }: { params: Promise<{ orgSlug: string; paymentId: string }> }) {
  const { orgSlug, paymentId } = await params;
  const { organisation, membership } = await requireOrgCapability(orgSlug, "payments.view");
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, organisationId: organisation.id },
    include: {
      lines: true,
      documents: { orderBy: { issuedAt: "asc" }, select: { id: true, kind: true, number: true, issuedAt: true, totalMinor: true, cancelledAt: true } },
      refunds: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!payment) notFound();
  const people = [payment.recordedById, payment.confirmedById, ...payment.refunds.map((refund) => refund.createdById)].filter((id): id is string => Boolean(id));
  const [org, users] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: organisation.id }, select: { name: true, slug: true, logoUrl: true, locale: true, timezone: true, offlineConfirmationRequired: true } }),
    people.length ? prisma.user.findMany({ where: { id: { in: people } }, select: { id: true, name: true, email: true } }) : [],
  ]);
  const names = Object.fromEntries(users.map((user) => [user.id, user.name ?? user.email ?? "Someone"]));
  const refundedMinor = payment.refunds.filter((refund) => refund.status !== "FAILED").reduce((sum, refund) => sum + refund.amountMinor, 0);
  return {
    org,
    payment,
    names,
    refundableMinor: payment.status === "PAID" ? Math.max(0, (payment.capturedMinor ?? payment.amountMinor) - refundedMinor) : 0,
    canManage: can(membership.role, "payments.manage"),
    isRecorder: payment.recordedById === membership.userId,
  };
}
