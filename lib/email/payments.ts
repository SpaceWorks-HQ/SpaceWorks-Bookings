import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { DocumentSnapshot } from "@/lib/payments/documents";
import { DOCUMENT_KIND_LABELS } from "@/lib/payments/numbering";
import { documentAmount, renderDocumentPdf } from "@/lib/payments/pdf";
import { absoluteUrl, sendBrandedEmail } from "./message";

export const PAYMENT_NOTICES = ["paid", "rejected", "refunded"] as const;
export type PaymentNotice = (typeof PAYMENT_NOTICES)[number];
type Payload = { organisationId: string; paymentId: string; notice: PaymentNotice };

const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 64;

export function asPaymentNoticePayload(value: Prisma.JsonValue): Payload | null {
  const p = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  if (!p || !isId(p.organisationId) || !isId(p.paymentId) || !PAYMENT_NOTICES.includes(p.notice as PaymentNotice)) return null;
  return p as Payload;
}

/** Tell the customer about their payment, attaching the receipt or credit note PDF when one was issued. */
export async function deliverPaymentNotice(payload: Payload, messageId: string): Promise<"sent" | "dropped"> {
  const payment = await prisma.payment.findFirst({
    where: { id: payload.paymentId, organisationId: payload.organisationId },
    include: {
      organisation: { select: { name: true, slug: true, locale: true } },
      documents: { where: { cancelledAt: null }, orderBy: { issuedAt: "desc" } },
    },
  });
  if (!payment) return "dropped";
  const org = payment.organisation;
  const first = payment.customerName.split(/\s+/)[0] || payment.customerName;
  const amount = documentAmount(payment.capturedMinor ?? payment.amountMinor, payment.currency, org.locale);
  const page = absoluteUrl(`/o/${org.slug}`);
  const wanted = payload.notice === "refunded" ? payment.documents.find((doc) => doc.kind === "CREDIT_NOTE") : payment.documents.find((doc) => doc.kind !== "CREDIT_NOTE");
  const attachments = [];
  if (wanted && (payload.notice === "paid" || payload.notice === "refunded")) {
    try {
      const pdf = await renderDocumentPdf(wanted.snapshot as unknown as DocumentSnapshot);
      attachments.push({ filename: `${wanted.number}.pdf`, content: Buffer.from(pdf), contentType: "application/pdf" });
    } catch {
      // The document stays downloadable by the team; a render failure never blocks the email.
    }
  }
  const content = {
    paid: {
      subject: `Payment received by ${org.name}`,
      heading: "Payment received",
      paragraphs: [`Hi ${first}, ${org.name} received your payment of ${amount}.`, wanted ? `Your ${DOCUMENT_KIND_LABELS[wanted.kind].toLowerCase()} ${wanted.number} is attached.` : "Your receipt will follow once the team has reviewed the payment."],
    },
    rejected: {
      subject: `${org.name} couldn't confirm your payment`,
      heading: "Payment not confirmed",
      paragraphs: [`Hi ${first}, ${org.name} couldn't match your payment of ${amount}${payment.utr ? ` with reference ${payment.utr}` : ""}.`, ...(payment.note ? [`Their note: ${payment.note}`] : []), `Reply to this email or contact ${org.name} to sort it out.`],
    },
    refunded: {
      subject: `Refund from ${org.name}`,
      heading: "Refund processed",
      paragraphs: [`Hi ${first}, ${org.name} has refunded ${wanted ? documentAmount(wanted.totalMinor, wanted.currency, org.locale) : "part of your payment"}.`, wanted ? `Credit note ${wanted.number} is attached.` : ""].filter(Boolean),
    },
  }[payload.notice];
  await sendBrandedEmail({ organisationId: payload.organisationId, to: payment.customerEmail, messageId, ...content, action: { label: `Visit ${org.name}`, url: page }, attachments });
  return "sent";
}
