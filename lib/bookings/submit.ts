import type { BookingStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { loadRules } from "@/lib/availability/context";
import { depositFor, type Quote } from "@/lib/pricing/quote";
import { assertCanActOn } from "./access";
import { isStaff, type Actor } from "./actor";
import { recomputeCharge } from "./charge";
import { defaultDb, lockBooking, withTx, type DbOrTx, type Tx } from "./db";
import { forbidden, invalidInput, invalidState } from "./errors";
import { recordBookingEvent } from "./events";
import { runBookingConfirmed } from "./hooks";
import { enqueueBookingNotice } from "./notify";
import { payLaterDueAt, payLaterOffered } from "./paymentDue";
import { loadPolicy, memberRateKinds, type AddOnSelection } from "./pricingInputs";
import { quoteSlots } from "./quote";
import { groupSlots, setRowPrices } from "./rows";
import { setBookingStatus } from "./status";
import { newManageToken } from "./tokens";

/**
 * Step two: the customer's details, extras and the price. What happens next depends on the space's rules:
 * free and instant → CONFIRMED; approval → REQUESTED (no money before approval); pay later (the space's mode, the
 * booker's choice where allowed, or PAY_NOW/DEPOSIT without a connected gateway) → CONFIRMED with a due date;
 * PAY_NOW/DEPOSIT → stays HELD and `awaitingPayment` until Phase 2 calls `confirmPaidBooking`. A fresh manage token
 * is issued and emailed.
 */

const contactSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(200),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email").max(320)),
  phone: z.string().trim().max(40).optional().nullable().transform((value) => value || null),
});

export type SubmitInput = {
  makerspaceId: string;
  bookingId: string;
  actor: Actor;
  contact: { name: string; email: string; phone?: string | null };
  attendees: number;
  addOns?: AddOnSelection[];
  purpose?: string;
  /** Staff only. */
  internalNotes?: string;
  /** The booker chooses to pay later (PAY_NOW/DEPOSIT spaces with `allowPayLater`; staff always may). */
  payLater?: boolean;
  /** Staff: use member rates when the typed email is on the member list (default yes). */
  applyMemberRate?: boolean;
  now?: Date;
};

export type SubmitResult = {
  bookingId: string;
  reference: string;
  status: BookingStatus;
  awaitingPayment: boolean;
  payLater: boolean;
  degradedToPayLater: boolean;
  paymentDueAt: Date | null;
  totalMinor: number;
  depositMinor: number;
  chargeMinor: number;
  manageToken: string;
  quote: Quote;
};

async function memberEmail(tx: Tx, actor: Actor, contactEmail: string, apply: boolean | undefined): Promise<string | null> {
  if (actor.kind === "STAFF") return apply === false ? null : contactEmail;
  if (actor.kind !== "CUSTOMER" || !actor.userId) return null;
  const user = await tx.user.findUnique({ where: { id: actor.userId }, select: { email: true, emailVerified: true } });
  return user?.email && user.emailVerified ? user.email : null;
}

export async function submitBooking(input: SubmitInput, db: DbOrTx = defaultDb()): Promise<SubmitResult> {
  const now = input.now ?? new Date();
  const contact = contactSchema.safeParse(input.contact);
  if (!contact.success) throw invalidInput(contact.error.issues[0]?.message ?? "Check the contact details.");
  if (!Number.isInteger(input.attendees) || input.attendees < 1) throw invalidInput("Enter how many people are coming.");
  if ((input.purpose ?? "").length > 2000 || (input.internalNotes ?? "").length > 4000) throw invalidInput("That note is too long.");

  return withTx(db, async (tx) => {
    const booking = await lockBooking(tx, input.makerspaceId, input.bookingId);
    assertCanActOn(booking, input.actor, "bookings.manage");
    if (booking.status !== "HELD") throw invalidState("This booking was already submitted.");
    if (!booking.holdExpiresAt || booking.holdExpiresAt <= now) throw invalidState("Your hold has expired. Choose a time again.");
    const space = await tx.space.findFirstOrThrow({ where: { id: booking.spaceId, makerspaceId: input.makerspaceId } });
    const makerspace = await tx.makerspace.findUniqueOrThrow({ where: { id: input.makerspaceId }, select: { timezone: true } });
    const rules = (await loadRules(tx, input.makerspaceId, space)).values;
    if (!booking.customerUserId && !isStaff(input.actor) && input.actor.kind === "CUSTOMER" && !rules.guestBookingAllowed) throw forbidden("Sign in to book this space.");
    if (space.capacity > 0 && input.attendees > space.capacity * booking.quantity) throw invalidInput(`Up to ${space.capacity * booking.quantity} people can use this booking.`);

    const rows = await tx.bookingOccurrence.findMany({ where: { bookingId: booking.id, status: "SCHEDULED" } });
    const slots = groupSlots(rows);
    const email = await memberEmail(tx, input.actor, contact.data.email, input.applyMemberRate);
    const kinds = await memberRateKinds(tx, input.makerspaceId, email, slots.map((slot) => ({ start: slot[0].startsAt })), makerspace.timezone);
    const quote = await quoteSlots(tx, {
      makerspaceId: input.makerspaceId,
      space,
      timeZone: makerspace.timezone,
      currency: booking.currency,
      rules,
      slots: slots.map((slot, index) => ({ start: slot[0].startsAt, end: slot[0].endsAt, rateKind: kinds[index] })),
      quantity: booking.quantity,
      attendees: input.attendees,
      addOns: input.addOns ?? [],
    });

    const total = quote.totalMinor;
    const chargeMode = total === 0 ? "FREE" : rules.chargeMode;
    const upfront = chargeMode === "PAY_NOW" || chargeMode === "DEPOSIT";
    const firstStart = slots[0][0].startsAt;
    if (input.payLater && upfront && !isStaff(input.actor)) {
      if (!rules.allowPayLater) throw invalidInput("Pay later isn't available for this space.");
      if (!payLaterOffered(rules, firstStart, now)) throw invalidInput("It's too close to the start to pay later. Pay now instead.");
    }
    const gateway = (await tx.makerspacePaymentSettings.findUnique({ where: { makerspaceId: input.makerspaceId }, select: { provider: true } }))?.provider ?? "NONE";
    const degraded = upfront && !input.payLater && gateway === "NONE";
    const payLater = chargeMode === "PAY_LATER" || (upfront && (Boolean(input.payLater) || degraded));
    const approval = rules.approvalMode === "APPROVAL" && !isStaff(input.actor);
    const target: BookingStatus = approval ? "REQUESTED" : chargeMode === "FREE" || payLater ? "CONFIRMED" : "HELD";
    const token = newManageToken();
    const leadCap = firstStart.getTime() - rules.leadTimeMinutes * 60_000;
    const data: Prisma.BookingUncheckedUpdateManyInput = {
      contactName: contact.data.name,
      contactEmail: contact.data.email,
      contactPhone: contact.data.phone,
      attendees: input.attendees,
      purpose: (input.purpose ?? "").trim(),
      ...(isStaff(input.actor) ? { internalNotes: (input.internalNotes ?? "").trim() } : {}),
      rateKind: kinds.includes("MEMBER") ? "MEMBER" : "PUBLIC",
      chargeMode,
      allowPayLater: rules.allowPayLater,
      payLater,
      awaitingPayment: target === "HELD",
      subtotalMinor: quote.subtotalMinor,
      taxMinor: quote.taxMinor,
      totalMinor: total,
      depositMinor: chargeMode === "DEPOSIT" ? depositFor(total, rules) : 0,
      chargeMinor: total,
      priceSnapshot: quote as unknown as Prisma.InputJsonValue,
      policySnapshot: (await loadPolicy(tx, input.makerspaceId, space.id, rules)) as unknown as Prisma.InputJsonValue,
      submittedAt: now,
      manageTokenHash: token.hash,
      paymentDueAt: target === "CONFIRMED" && payLater ? payLaterDueAt(rules, firstStart, now) : null,
      overdueAction: target === "CONFIRMED" && payLater ? rules.overdueAction : null,
      requestExpiresAt: approval ? new Date(Math.max(now.getTime(), Math.min(now.getTime() + rules.requestExpiryHours * 3_600_000, leadCap))) : null,
      confirmedAt: target === "CONFIRMED" ? now : null,
    };
    if (target === "HELD") await tx.booking.update({ where: { id: booking.id }, data });
    else await setBookingStatus(tx, booking, target, { requestsBlockSlot: rules.requestsBlockSlot, now, data });

    const ordered = slots.flat();
    await setRowPrices(tx, ordered.map((row, index) => ({ id: row.id, priceMinor: quote.occurrencePrices[index] ?? 0, rateKind: kinds[slots.findIndex((slot) => slot.includes(row))] })));
    const charge = await recomputeCharge(tx, booking.id);
    await recordBookingEvent(tx, { makerspaceId: input.makerspaceId, bookingId: booking.id, kind: target === "HELD" ? "submitted" : target === "REQUESTED" ? "requested" : "confirmed", actor: input.actor, data: { totalMinor: total, chargeMode, payLater, degradedToPayLater: degraded, rateKind: data.rateKind } });
    const notice = target === "REQUESTED" ? "requested" : target === "CONFIRMED" ? "confirmed" : "received";
    await enqueueBookingNotice(tx, { makerspaceId: input.makerspaceId, bookingId: booking.id, notice, manageToken: token.token });
    if (target === "CONFIRMED") await runBookingConfirmed(tx, booking.id);
    const saved = await tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
    return {
      bookingId: booking.id,
      reference: booking.reference,
      status: saved.status,
      awaitingPayment: saved.awaitingPayment,
      payLater,
      degradedToPayLater: degraded,
      paymentDueAt: saved.paymentDueAt,
      totalMinor: total,
      depositMinor: saved.depositMinor,
      chargeMinor: charge.after,
      manageToken: token.token,
      quote,
    };
  });
}
