// Demo money: a few paid bookings (UPI at the desk, a Razorpay-style card payment), one refund, so the booking
// pages, Payments, Reconciliation and Reports show real figures. Idempotent: rows are keyed by their reference.
// Booking.paidMinor/refundedMinor follow by trigger; documents are not issued (numbers start with real money).
// Each payment copies its booking's tax snapshot (no tax in the demo) and is dated from the booking's own times.

export async function seedMoney(prisma, { makerspaceId, owner }) {
  const demos = [
    { reference: "BK-DE0004", key: "demo-pay-0004", provider: "OFFLINE", method: "upi", purpose: "FULL" },
    { reference: "BK-DE0007", key: "demo-pay-0007", provider: "RAZORPAY", method: "card", purpose: "FULL" },
    { reference: "BK-DE0005", key: "demo-pay-0005", provider: "RAZORPAY", method: "upi", purpose: "FULL", refund: true },
  ];
  for (const demo of demos) {
    const booking = await prisma.booking.findUnique({ where: { makerspaceId_reference: { makerspaceId, reference: demo.reference } } });
    if (!booking || booking.totalMinor === 0) continue;
    const paidAt = booking.submittedAt ?? booking.createdAt;
    await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findFirst({ where: { makerspaceId, reference: demo.key } }) ?? await tx.payment.create({
        data: {
          makerspaceId, bookingId: booking.id, purpose: demo.purpose, customerName: booking.contactName, customerEmail: booking.contactEmail, customerStateCode: "KL",
          status: "PAID", provider: demo.provider, method: demo.method, currency: booking.currency, amountMinor: booking.totalMinor, paidAt, reference: demo.key,
          gatewayOrderId: demo.provider === "OFFLINE" ? null : `order_${demo.key}`, gatewayPaymentId: demo.provider === "OFFLINE" ? null : `pay_${demo.key}`,
          recordedById: demo.provider === "OFFLINE" ? owner.id : null, confirmedById: demo.provider === "OFFLINE" ? owner.id : null, taxSnapshot: booking.priceSnapshot.tax,
          lines: { create: [{ kind: "BOOKING", description: `Booking ${demo.reference}`, currency: booking.currency, amountMinor: booking.totalMinor, taxableMinor: booking.totalMinor, cgstMinor: 0, sgstMinor: 0 }] },
        },
      });
      if (!demo.refund || await tx.refund.findFirst({ where: { makerspaceId, paymentId: payment.id } })) return;
      const at = booking.cancelledAt ?? paidAt;
      await tx.refund.create({ data: { makerspaceId, paymentId: payment.id, currency: booking.currency, amountMinor: booking.totalMinor, kind: "POLICY", reason: booking.cancelReason ?? "Cancelled by the customer", status: "PROCESSED", processedAt: at, gatewayRefundId: `rfnd_${demo.key}`, sentAt: at, createdById: owner.id } });
    });
  }
}
