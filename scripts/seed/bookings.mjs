import crypto from "node:crypto";
import { refundTiers } from "./booking-catalogue.mjs";

// Dates use Tinkerspace's timezone, independent of the seed machine's timezone.
const DAY = 86_400_000;
function localTime(now, offset, hour) {
  const wall = new Date(now.getTime() + 330 * 60_000);
  const midnight = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate());
  return new Date(midnight + offset * DAY + (hour * 60 - 330) * 60_000);
}
function openDay(now, offset) {
  return new Date(localTime(now, offset, 12).getTime() + 330 * 60_000).getUTCDay() === 0 ? offset + 1 : offset;
}

export async function seedBookings(prisma, { makerspaceId, spaces, owner, front, customer, now }) {
  const upcoming = (offset) => openDay(now, offset);
  const demos = [
    { key: "0001", space: "meeting-room", day: upcoming(1), hour: 10, status: "CONFIRMED", purpose: "Community planning", total: 0 },
    { key: "0002", space: "laser-studio", day: upcoming(2), hour: 11, status: "REQUESTED", purpose: "Prototype planning", total: 120_000, member: true },
    { key: "0003", space: "laser-studio", day: upcoming(3), hour: 15, status: "HELD", purpose: "Studio session awaiting payment", total: 160_000 },
    { key: "0004", space: "hot-desks", day: upcoming(4), hour: 9, duration: 4, status: "CONFIRMED", purpose: "Remote working morning", total: 20_000, member: true },
    { key: "0005", space: "build-hall", day: upcoming(5), hour: 17, status: "CANCELLED", purpose: "Build night postponed", total: 400_000 },
    { key: "0006", space: "meeting-room", day: -1, hour: 14, status: "CONFIRMED", checkedIn: true, purpose: "Yesterday's design review", total: 0 },
    // Staff agreed an overnight build: the day sheet has an arrival even outside normal opening hours.
    { key: "0007", space: "build-hall", day: 0, hour: 19, duration: 14, status: "CONFIRMED", purpose: "Overnight community build", total: 2_800_000 },
    { key: "0008", space: "build-hall", day: upcoming(6), hour: 10, status: "REQUESTED", purpose: "Weekend community build", total: 400_000 },
  ];
  // Reset only these named fixtures, including their rolling dates. Release them together before moving them
  // so yesterday's rows cannot clash with tomorrow's. The append-only timeline is created once, never deleted.
  await prisma.$transaction(async (tx) => {
    const references = demos.map((demo) => `BK-DE${demo.key}`);
    await tx.bookingOccurrence.updateMany({ where: { makerspaceId, booking: { reference: { in: references } } }, data: { blocking: false } });
    for (const demo of demos) {
      const space = spaces[demo.space];
      const startsAt = localTime(now, demo.day, demo.hour);
      const endsAt = new Date(startsAt.getTime() + (demo.duration ?? 2) * 3_600_000);
      const reference = `BK-DE${demo.key}`;
      const existing = await tx.booking.findUnique({ where: { makerspaceId_reference: { makerspaceId, reference } } });
      const cancelled = demo.status === "CANCELLED";
      const confirmed = demo.status === "CONFIRMED";
      const payLater = demo.space === "hot-desks" || demo.key === "0007";
      const attendees = demo.space === "hot-desks" ? 1 : 2;
      const rateKind = demo.member ? "MEMBER" : "PUBLIC";
      const chargeMode = space.ruleOverrides.chargeMode;
      const token = crypto.randomBytes(32).toString("base64url");
      const line = { kind: "SPACE", paymentKind: "BOOKING", description: space.name, detail: `${demo.duration ?? 2} hours${demo.member ? ", member rate" : ""}`,
        slotIndex: 0, refId: null, listedMinor: demo.total, taxableMinor: demo.total, amountMinor: demo.total,
        cgstMinor: 0, sgstMinor: 0, igstMinor: 0, otherTaxMinor: 0, sac: null };
      const tax = { version: 1, mode: "NONE", documentKind: "RECEIPT", rateBps: 0, inclusive: true, taxName: "Tax",
        supplierState: null, gstin: null, legalName: null, address: null, sac: null, zeroRatedExport: false, lutNumber: null };
      const data = {
        makerspaceId, spaceId: space.id, reference, status: demo.status, source: demo.key === "0007" ? "STAFF" : "PUBLIC", customerUserId: customer.id,
        createdById: demo.key === "0007" ? owner.id : null,
        overrideReason: demo.key === "0007" ? "Overnight community build agreed by the owner" : null,
        approvedAt: null, approvedById: null, declinedAt: null, declinedById: null, declineReason: null, expiredAt: null,
        contactName: customer.name, contactEmail: customer.email, attendees,
        currency: "INR", purpose: demo.purpose, rateKind, chargeMode, payLater,
        awaitingPayment: demo.status === "HELD", holdExpiresAt: demo.status === "HELD" ? new Date(now.getTime() + 15 * 60_000) : null,
        requestExpiresAt: demo.status === "REQUESTED" ? new Date(now.getTime() + 7 * DAY) : null,
        submittedAt: now, confirmedAt: confirmed ? now : null,
        paymentDueAt: payLater ? new Date(Math.max(startsAt.getTime() - DAY, now.getTime() + 2 * 3_600_000)) : null,
        overdueAction: payLater ? "NOTIFY_STAFF" : null,
        totalMinor: demo.total, subtotalMinor: demo.total, chargeMinor: cancelled ? 0 : demo.total,
        depositMinor: chargeMode === "DEPOSIT" ? demo.total / 4 : 0,
        manageTokenHash: existing?.manageTokenHash ?? crypto.createHash("sha256").update(token).digest("hex"),
        cancelledAt: cancelled ? now : null, cancelKind: cancelled ? "CUSTOMER" : null,
        cancelReason: cancelled ? "The group chose another date" : null,
        priceSnapshot: { version: 1, currency: "INR", quantity: 1, attendees, rateKinds: [rateKind], addOns: [],
          lines: [line], subtotalMinor: demo.total, taxMinor: 0, totalMinor: demo.total, slotTotals: [demo.total], occurrencePrices: [demo.total], tax },
        policySnapshot: { refundTiers, depositRefundable: true, chargeLateCancelWhenUnpaid: false, noShowCharge: "FULL" },
      };
      const booking = await tx.booking.upsert({ where: { makerspaceId_reference: { makerspaceId, reference } }, update: data,
        create: { ...data, events: { create: {
          kind: cancelled ? "cancelled" : demo.checkedIn ? "checked-in" : demo.status.toLowerCase(),
          actorKind: "STAFF", actorUserId: owner.id, data: { demo: true } } } },
      });
      const occurrence = { makerspaceId, bookingId: booking.id, spaceId: space.id, slotIndex: 0, unit: 0, startsAt, endsAt,
          blockStart: startsAt, blockEnd: endsAt, policyAnchorAt: startsAt, blocking: !cancelled,
          status: cancelled ? "CANCELLED" : demo.checkedIn ? "CHECKED_IN" : "SCHEDULED", rateKind, priceMinor: demo.total,
          cancelledAt: cancelled ? now : null, cancelKind: cancelled ? "CUSTOMER" : null,
          checkedInAt: demo.checkedIn ? startsAt : null, checkedInById: demo.checkedIn ? front.id : null,
          noShowAt: null, noShowById: null, completedAt: null, keptFeeMinor: 0 };
      // Older demo runs used generated occurrence ids; retain them when upgrading the fixture.
      const row = await tx.bookingOccurrence.findFirst({ where: { bookingId: booking.id } });
      if (row) await tx.bookingOccurrence.update({ where: { id: row.id }, data: occurrence });
      else await tx.bookingOccurrence.create({ data: occurrence });
    }
  });
}
