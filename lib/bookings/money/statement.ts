import "server-only";

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import { prisma } from "@/lib/db";
import { A4, INK, loadFonts, MARGIN, MUTED, RULE, documentAmount, text, type Pen } from "@/lib/payments/pdf";
import { paymentState, PAYMENT_STATE_LABELS, balanceDue, refundDue } from "../obligation";

/**
 * A booking statement (unnumbered, not a tax document): what was booked and charged, every payment and refund, and
 * what is owed either way. Always available to the customer and the team; receipts and credit notes stay the
 * numbered documents.
 */

const PURPOSE: Record<string, string> = { FULL: "Payment", DEPOSIT: "Deposit", BALANCE: "Balance", DIFFERENCE: "Difference" };

export async function loadStatement(makerspaceId: string, bookingId: string) {
  return prisma.booking.findFirst({
    where: { id: bookingId, makerspaceId },
    include: {
      makerspace: { select: { name: true, addressLine: true, city: true, contactEmail: true, timezone: true, locale: true } },
      space: { select: { name: true } },
      occurrences: { orderBy: [{ startsAt: "asc" }, { unit: "asc" }], select: { startsAt: true, endsAt: true, status: true, priceMinor: true, keptFeeMinor: true } },
      payments: { where: { status: "PAID" }, orderBy: { paidAt: "asc" }, include: { documents: { select: { number: true, kind: true } }, refunds: { where: { status: { in: ["PROCESSED", "PENDING"] } }, orderBy: { createdAt: "asc" } } } },
    },
  });
}

type Statement = NonNullable<Awaited<ReturnType<typeof loadStatement>>>;

export async function renderStatementPdf(booking: Statement, now = new Date()): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fonts = await loadFonts();
  const regular = await pdf.embedFont(fonts.regular, { subset: true });
  const bold = await pdf.embedFont(fonts.bold, { subset: true });
  pdf.setTitle(`Statement ${booking.reference}`);
  pdf.setProducer("Space Works Bookings");
  const pen: Pen = { page: pdf.addPage(A4), regular, bold };
  const right = A4[0] - MARGIN;
  const zone = booking.makerspace.timezone;
  const money = (minor: number) => documentAmount(minor, booking.currency, booking.makerspace.locale);
  const when = (value: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(value);
  let y = A4[1] - MARGIN - 10;
  const line = (gap = 14) => {
    y -= gap;
    if (y < MARGIN + 40) {
      pen.page = pdf.addPage(A4);
      y = A4[1] - MARGIN - 10;
    }
  };
  const row = (label: string, amount: string, options: { bold?: boolean; color?: typeof MUTED } = {}) => {
    line();
    text(pen, label, MARGIN, y, { maxWidth: right - MARGIN - 110, bold: options.bold, color: options.color ?? INK });
    text(pen, amount, right, y, { align: "right", bold: options.bold });
  };
  const heading = (value: string) => {
    line(26);
    text(pen, value, MARGIN, y, { size: 8.5, color: MUTED });
    line(6);
    pen.page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 0.6, color: RULE });
  };

  text(pen, booking.makerspace.name, MARGIN, y, { size: 17, bold: true, maxWidth: 300 });
  text(pen, "Booking statement", right, y, { size: 15, bold: true, align: "right" });
  line(18);
  text(pen, [booking.makerspace.addressLine, booking.makerspace.city].filter(Boolean).join(", "), MARGIN, y, { color: MUTED, maxWidth: 300 });
  text(pen, `Booking ${booking.reference}`, right, y, { align: "right", bold: true });
  line(13);
  text(pen, booking.makerspace.contactEmail ?? "", MARGIN, y, { color: MUTED, maxWidth: 300 });
  text(pen, `As of ${when(now)}`, right, y, { align: "right", color: MUTED });
  line(24);
  text(pen, `${booking.contactName} · ${booking.contactEmail}`, MARGIN, y, { bold: true, maxWidth: right - MARGIN });
  line(13);
  text(pen, `${booking.space.name} · ${booking.status.toLowerCase()} · this statement is not a tax document`, MARGIN, y, { color: MUTED, maxWidth: right - MARGIN });

  heading("Times");
  for (const occurrence of booking.occurrences) {
    const fee = occurrence.status === "CANCELLED" ? (occurrence.keptFeeMinor ? `fee ${money(occurrence.keptFeeMinor)}` : "cancelled") : money(occurrence.priceMinor);
    row(`${when(occurrence.startsAt)} to ${when(occurrence.endsAt)} · ${occurrence.status.toLowerCase().replace("_", " ")}`, fee, { color: occurrence.status === "CANCELLED" ? MUTED : INK });
  }
  row("Total booked", money(booking.totalMinor));
  if (booking.concessionMinor) row("Given back by the team", `- ${money(booking.concessionMinor)}`);
  row("Charge now", money(booking.chargeMinor), { bold: true });

  heading("Payments");
  if (booking.payments.length === 0) row("No payments yet", "");
  for (const payment of booking.payments) {
    const document = payment.documents.find((item) => item.kind !== "CREDIT_NOTE");
    row(`${payment.paidAt ? when(payment.paidAt) : ""} · ${PURPOSE[payment.purpose ?? "FULL"] ?? "Payment"} · ${payment.method ?? payment.provider.toLowerCase()}${document ? ` · ${document.number}` : ""}`, money(payment.capturedMinor ?? payment.amountMinor));
    for (const refund of payment.refunds) row(`   Refund ${refund.status === "PENDING" ? "on its way" : refund.processedAt ? when(refund.processedAt) : ""} · ${refund.reason}`, `- ${money(refund.amountMinor)}`, { color: MUTED });
  }

  heading("Where it stands");
  row("Paid", money(booking.paidMinor));
  row("Refunded", money(booking.refundedMinor));
  const balance = balanceDue(booking.chargeMinor, booking);
  const back = refundDue(booking.chargeMinor, booking);
  if (balance) row(booking.paymentDueAt ? `Still to pay, due ${when(booking.paymentDueAt)}` : "Still to pay", money(balance), { bold: true });
  if (back) row("Still to come back to you", money(back), { bold: true });
  row("Status", PAYMENT_STATE_LABELS[paymentState(booking, now)], { bold: true });
  return pdf.save();
}
