// Demo money: a few paid bookings (UPI at the desk, a Razorpay-style card payment), one refund, so the booking
// pages, Payments, Reconciliation and Reports show real figures. Idempotent: rows are keyed by their reference.
// Booking.paidMinor/refundedMinor follow by trigger; documents are not issued (numbers start with real money).

const TAX = { version: 1, mode: "GST", documentKind: "TAX_INVOICE", rateBps: 1800, inclusive: true, taxName: "GST", supplierState: "KL", gstin: null, legalName: null, address: null, sac: "997212", zeroRatedExport: false, lutNumber: null };

export async function seedMoney(prisma, { makerspaceId, owner, now }) {
  const day = 86_400_000;
  const demos = [
    { reference: "BK-DE0004", key: "demo-pay-0004", provider: "OFFLINE", method: "upi", purpose: "FULL", paidAt: new Date(now.getTime() - 2 * day) },
    { reference: "BK-DE0007", key: "demo-pay-0007", provider: "RAZORPAY", method: "card", purpose: "FULL", paidAt: new Date(now.getTime() - 5 * day) },
    { reference: "BK-DE0005", key: "demo-pay-0005", provider: "RAZORPAY", method: "upi", purpose: "FULL", paidAt: new Date(now.getTime() - 9 * day), refund: true },
  ];
  for (const demo of demos) {
    const booking = await prisma.booking.findUnique({ where: { makerspaceId_reference: { makerspaceId, reference: demo.reference } } });
    if (!booking || booking.totalMinor === 0) continue;
    if (await prisma.payment.findFirst({ where: { makerspaceId, reference: demo.key } })) continue;
    const amount = booking.totalMinor;
    const taxable = Math.round((amount * 10_000) / 11_800);
    const tax = amount - taxable;
    const payment = await prisma.payment.create({
      data: {
        makerspaceId, bookingId: booking.id, purpose: demo.purpose, customerName: booking.contactName, customerEmail: booking.contactEmail, customerStateCode: "KL",
        status: "PAID", provider: demo.provider, method: demo.method, currency: booking.currency, amountMinor: amount, paidAt: demo.paidAt, reference: demo.key,
        gatewayOrderId: demo.provider === "OFFLINE" ? null : `order_${demo.key}`, gatewayPaymentId: demo.provider === "OFFLINE" ? null : `pay_${demo.key}`,
        recordedById: demo.provider === "OFFLINE" ? owner.id : null, confirmedById: demo.provider === "OFFLINE" ? owner.id : null, taxSnapshot: TAX,
        lines: { create: [{ kind: "BOOKING", description: `Booking ${demo.reference}`, currency: booking.currency, amountMinor: amount, taxableMinor: taxable + (tax % 2), cgstMinor: Math.floor(tax / 2), sgstMinor: Math.floor(tax / 2) }] },
      },
    });
    if (demo.refund) {
      await prisma.refund.create({ data: { makerspaceId, paymentId: payment.id, currency: booking.currency, amountMinor: amount, kind: "VENUE", reason: "The makerspace cancelled", status: "PROCESSED", processedAt: new Date(demo.paidAt.getTime() + day), gatewayRefundId: `rfnd_${demo.key}`, sentAt: demo.paidAt, createdById: owner.id } });
    }
  }
}
