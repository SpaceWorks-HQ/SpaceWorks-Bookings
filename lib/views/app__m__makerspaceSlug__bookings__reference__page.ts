import { auth } from "@/lib/auth";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { loadPublicMakerspace } from "@/lib/publicMakerspace";
import { loadRules } from "@/lib/availability/context";
import { canReadBooking } from "@/lib/ics/access";
import { checkInCode } from "@/lib/bookings/tokens";
import { paymentState, PAYMENT_STATE_LABELS, balanceDue } from "@/lib/bookings/obligation";
import { cancellationPreview } from "@/lib/bookings/cancellationPreview";
import { bookingDate } from "@/lib/bookings/publicUi";
import { slotRows } from "@/lib/ics/booking";
import { paymentPlan } from "@/lib/bookings/money/start";

export async function loadPublicBookingPage({ params, searchParams }: { params: Promise<{ makerspaceSlug: string; reference: string }>; searchParams: Promise<{ t?: string }> }) {
  const { makerspaceSlug, reference } = await params;
  const query = await searchParams;
  const token = typeof query.t === "string" ? query.t : undefined;
  const makerspace = await loadPublicMakerspace(makerspaceSlug);
  const session = await auth();
  const booking = await prisma.booking.findFirst({ where: { makerspaceId: makerspace.id, reference }, include: { space: true, occurrences: { orderBy: [{ startsAt: "asc" }, { unit: "asc" }] } } });
  if (!booking || !canReadBooking(booking, { makerspaceId: makerspace.id, reference, userId: session?.user?.id, token })) notFound();
  const now = new Date();
  const rules = (await loadRules(prisma, makerspace.id, booking.space)).values;
  const slots = slotRows(booking.occurrences);
  const cancellations = [{ type: "ALL" } as const, ...slots.flatMap((row) => [{ type: "OCCURRENCE" as const, occurrenceId: row.id }, { type: "FOLLOWING" as const, occurrenceId: row.id }])]
    .map((scope) => cancellationPreview(booking, booking.occurrences, scope, now, rules.customerCancelCutoffHours));
  const settings = await prisma.makerspacePaymentSettings.findUnique({ where: { makerspaceId: makerspace.id }, select: { provider: true, secretEncrypted: true, upiVpa: true, upiPayeeName: true, offlineInstructions: true } });
  const plan = makerspace.status === "ACTIVE" ? paymentPlan(booking) : null;
  const full = plan?.purpose === "DEPOSIT" ? paymentPlan(booking, { full: true }) : null;
  const payment = {
    plan, fullAmountMinor: full?.amountMinor ?? null,
    online: settings && settings.provider !== "NONE" && settings.secretEncrypted ? settings.provider : null,
    upiVpa: settings?.upiVpa ?? null, upiPayeeName: settings?.upiPayeeName ?? null, offlineInstructions: settings?.offlineInstructions ?? "",
  };
  return { makerspace, payment, detail: {
    id: booking.id, reference, status: booking.status, space: { id: booking.spaceId, name: booking.space.name, units: booking.space.units },
    currency: booking.currency, totalMinor: booking.totalMinor, chargeMinor: booking.chargeMinor, priceSnapshot: booking.priceSnapshot,
    paymentLabel: PAYMENT_STATE_LABELS[paymentState(booking, now)], balanceMinor: balanceDue(booking.chargeMinor, booking),
    awaitingPayment: booking.awaitingPayment, payLater: booking.payLater, paymentDueAt: booking.paymentDueAt,
    holdExpiresAt: booking.holdExpiresAt, declineReason: booking.declineReason, cancelReason: booking.cancelReason,
    code: booking.status === "CONFIRMED" ? checkInCode(makerspace.id, reference) : null,
    slots: slots.map((row) => ({ id: row.id, startsAt: row.startsAt, endsAt: row.endsAt, status: row.status,
      canMove: makerspace.status === "ACTIVE" && ["CONFIRMED", "REQUESTED"].includes(booking.status) && row.status === "SCHEDULED" && rules.customerRescheduleAllowed && now.getTime() <= row.startsAt.getTime() - rules.customerRescheduleCutoffHours * 3_600_000 })),
    quantity: booking.quantity, cancellations, rules, today: bookingDate(now, makerspace.timezone),
    // Account ownership works even when an old token was supplied; avoid sending an invalid token to actions.
    manageToken: session?.user?.id === booking.customerUserId ? undefined : token,
  } };
}
