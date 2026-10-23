import "server-only";

import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { loadRules } from "@/lib/availability/context";
import { SYSTEM } from "../actor";
import { cancelBooking } from "../cancel";
import { lockBooking } from "../db";
import { enqueueBookingNotice } from "../notify";
import { expireClosedCheckouts } from "./start";
import { sendBookingRefunds } from "./send";

/** Money upkeep for bookings (beat jobs, every minute or five). Each run is idempotent and safe to overlap. */

const HOUR = 3_600_000;
const BATCH = 100;

/** The latest reminder point (due date ± offset hours) that has passed, or null. Pure. */
export function latestReminderPoint(dueAt: Date, offsetsHours: number[], direction: "before" | "after", now: Date): Date | null {
  const points = offsetsHours
    .map((hours) => dueAt.getTime() + (direction === "before" ? -hours : hours) * HOUR)
    .filter((point) => point <= now.getTime() && (direction === "after" || point < dueAt.getTime()));
  return points.length ? new Date(Math.max(...points)) : null;
}
type Due = { id: string; makerspaceId: string; spaceId: string; paymentDueAt: Date; overdueAction: "AUTO_CANCEL" | "NOTIFY_STAFF" | null };

/** Confirmed bookings past their due date with money still owed: auto-cancel, or tell the customer and the team. */
export async function handleOverduePayments(now = new Date()): Promise<{ cancelled: number; notified: number }> {
  const rows = await prisma.$queryRaw<Due[]>`
    SELECT "id", "makerspaceId", "spaceId", "paymentDueAt", "overdueAction"::text AS "overdueAction" FROM "Booking"
    WHERE "status" = 'CONFIRMED' AND "writtenOffAt" IS NULL AND "paymentDueAt" < ${now}
      AND "chargeMinor" > "paidMinor" - "refundedMinor"
      AND ("overdueAction" = 'AUTO_CANCEL' OR "overdueNotifiedAt" IS NULL OR "paymentDueAt" > ${new Date(now.getTime() - 31 * 24 * HOUR)})
    ORDER BY "paymentDueAt" LIMIT ${BATCH}`;
  let cancelled = 0;
  let notified = 0;
  for (const row of rows) {
    try {
      if (row.overdueAction === "AUTO_CANCEL") {
        const result = await cancelBooking({ makerspaceId: row.makerspaceId, bookingId: row.id, actor: SYSTEM, kind: "SYSTEM", reason: "Payment wasn't received by the due date.", now });
        await sendBookingRefunds(result.refundIds, now);
        cancelled += 1;
        continue;
      }
      const space = await prisma.space.findUniqueOrThrow({ where: { id: row.spaceId } });
      const rules = (await loadRules(prisma, row.makerspaceId, space)).values;
      const point = latestReminderPoint(row.paymentDueAt, rules.overdueReminderHoursAfterDue, "after", now);
      if (!point) continue;
      const sent = await prisma.$transaction(async (tx) => {
        const booking = await lockBooking(tx, row.makerspaceId, row.id);
        if ((booking.overdueNotifiedAt && booking.overdueNotifiedAt >= point) || booking.status !== "CONFIRMED") return false;
        await tx.booking.update({ where: { id: booking.id }, data: { overdueNotifiedAt: now } });
        await enqueueBookingNotice(tx, { makerspaceId: row.makerspaceId, bookingId: row.id, notice: "payment-overdue" });
        await recordAuditEvent({ action: "BOOKING_PAYMENT_OVERDUE", actorUserId: null, makerspaceId: row.makerspaceId, targetType: "Booking", targetId: row.id, client: tx });
        return true;
      });
      if (sent) notified += 1;
    } catch {
      console.error("[bookings] an overdue booking could not be handled");
    }
  }
  return { cancelled, notified };
}

/** Reminders before the due date, one per offset in `paymentReminderHoursBeforeDue`. */
export async function sendPaymentReminders(now = new Date()): Promise<number> {
  const rows = await prisma.$queryRaw<Due[]>`
    SELECT "id", "makerspaceId", "spaceId", "paymentDueAt", NULL AS "overdueAction" FROM "Booking"
    WHERE "status" = 'CONFIRMED' AND "writtenOffAt" IS NULL
      AND "paymentDueAt" > ${now} AND "paymentDueAt" < ${new Date(now.getTime() + 30 * 24 * HOUR)}
      AND "chargeMinor" > "paidMinor" - "refundedMinor"
    ORDER BY "paymentDueAt" LIMIT ${BATCH}`;
  let sent = 0;
  for (const row of rows) {
    const space = await prisma.space.findUniqueOrThrow({ where: { id: row.spaceId } });
    const rules = (await loadRules(prisma, row.makerspaceId, space)).values;
    const point = latestReminderPoint(row.paymentDueAt, rules.paymentReminderHoursBeforeDue, "before", now);
    if (!point) continue;
    const claimed = await prisma.$transaction(async (tx) => {
      const updated = await tx.booking.updateMany({ where: { id: row.id, OR: [{ paymentReminderSentAt: null }, { paymentReminderSentAt: { lt: point } }] }, data: { paymentReminderSentAt: now } });
      if (updated.count === 1) await enqueueBookingNotice(tx, { makerspaceId: row.makerspaceId, bookingId: row.id, notice: "payment-due" });
      return updated.count === 1;
    });
    if (claimed) sent += 1;
  }
  return sent;
}

/** Open checkouts of bookings that ended (expired hold, cancelled, declined) can't be paid any more. */
export async function closeEndedCheckouts(): Promise<number> {
  const open = await prisma.payment.findMany({
    where: { status: "PENDING", provider: { in: ["RAZORPAY", "STRIPE"] }, booking: { status: { in: ["EXPIRED", "CANCELLED", "DECLINED"] } } },
    take: BATCH, select: { id: true, makerspaceId: true, provider: true, gatewayOrderId: true },
  });
  for (const payment of open) {
    const closed = await prisma.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "CANCELLED", note: "Closed: the booking ended." } });
    if (closed.count === 1) await expireClosedCheckouts(payment.makerspaceId, [payment]);
  }
  return open.length;
}

/** The trigger-maintained caches must equal the sums; a mismatch is logged and audited, never rewritten here. */
export async function checkBookingMoney(makerspaceId?: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ id: string; makerspaceId: string }>>`
    SELECT b."id", b."makerspaceId" FROM "Booking" b
    WHERE (${makerspaceId ?? null}::text IS NULL OR b."makerspaceId" = ${makerspaceId ?? null}) AND (b."paidMinor" <> COALESCE((SELECT SUM(COALESCE(p."capturedMinor", p."amountMinor")) FROM "Payment" p WHERE p."bookingId" = b."id" AND p."status" = 'PAID'), 0)
       OR b."refundedMinor" <> COALESCE((SELECT SUM(r."amountMinor") FROM "Refund" r JOIN "Payment" p ON p."id" = r."paymentId" WHERE p."bookingId" = b."id" AND r."status" = 'PROCESSED'), 0))
    LIMIT ${BATCH}`;
  for (const row of rows) {
    console.error("[bookings] booking money caches disagree with payments and refunds");
    await recordAuditEvent({ action: "BOOKING_MONEY_MISMATCH", actorUserId: null, makerspaceId: row.makerspaceId, targetType: "Booking", targetId: row.id });
  }
  return rows.length;
}
