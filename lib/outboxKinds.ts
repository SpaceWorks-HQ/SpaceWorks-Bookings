import "server-only";

import type { Prisma } from "@prisma/client";
import { sendPasswordResetEmail } from "@/lib/email/passwordReset";
import { sendEmailVerificationEmail } from "@/lib/email/emailVerification";
import { asAdminPayload, asInvitePayload, asNoticePayload, deliverAdminApplicationAlert, deliverOrganisationNotice, deliverOwnerInvite } from "@/lib/email/organisation";
import { asPaymentNoticePayload, deliverPaymentNotice } from "@/lib/email/payments";
import { asChatPayload, deliverChatNotice } from "@/lib/chat/notify";
import { asLoginAlertPayload, asLoginCodePayload, deliverLoginAlert, deliverLoginCode } from "@/lib/email/loginSecurity";

/** What a handler reports after a delivery attempt. Throw to retry; throw PermanentOutboxError to give up. */
export type DeliveryOutcome = "sent" | "dropped";

export type OutboxKindHandler = {
  /** Payload carries a bearer link (reset, verification, invite): delete the row after sending. */
  capability: boolean;
  /** One-hour links: retry within their lifetime. */
  shortLived?: boolean;
  deliver(payload: Prisma.JsonValue, messageId: string): Promise<DeliveryOutcome>;
};

// ---------- payload checks shared by handlers ----------

export function asRecord(value: Prisma.JsonValue): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

export function isEmail(value: unknown): value is string {
  return isBoundedString(value, 320) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isIsoDate(value: unknown): value is string {
  return isBoundedString(value, 64) && !Number.isNaN(Date.parse(value));
}

export function isSafeMessageUrl(value: unknown): value is string {
  if (!isBoundedString(value, 2048)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (process.env.NODE_ENV !== "production" && url.protocol === "http:");
  } catch {
    return false;
  }
}

export function isExpired(expiresAt: string | undefined, now = new Date()) {
  return expiresAt !== undefined && new Date(expiresAt) <= now;
}

/** Thrown by a handler for a payload or state that can never be delivered; the row is not retried. */
export class PermanentOutboxError extends Error {
  override name = "PermanentOutboxError";
}

// ---------- kinds ----------

const passwordReset: OutboxKindHandler = {
  capability: true,
  shortLived: true,
  async deliver(value, messageId) {
    const p = asRecord(value);
    if (!p || !isEmail(p.to) || !isSafeMessageUrl(p.resetUrl) || !isIsoDate(p.expiresAt)) throw new PermanentOutboxError();
    if (isExpired(p.expiresAt as string)) return "dropped";
    await sendPasswordResetEmail({ to: p.to as string, resetUrl: p.resetUrl as string, messageId });
    return "sent";
  },
};

const emailVerification: OutboxKindHandler = {
  capability: true,
  shortLived: true,
  async deliver(value, messageId) {
    const p = asRecord(value);
    if (!p || !isEmail(p.to) || !isSafeMessageUrl(p.verificationUrl) || !isIsoDate(p.expiresAt)) throw new PermanentOutboxError();
    if (isExpired(p.expiresAt as string)) return "dropped";
    await sendEmailVerificationEmail({ to: p.to as string, verificationUrl: p.verificationUrl as string, messageId });
    return "sent";
  },
};

const organisationNotice: OutboxKindHandler = {
  capability: false,
  async deliver(value, messageId) {
    const payload = asNoticePayload(value);
    if (!payload) throw new PermanentOutboxError();
    return deliverOrganisationNotice(payload, messageId);
  },
};

const organisationApplicationAlert: OutboxKindHandler = {
  capability: false,
  async deliver(value, messageId) {
    const payload = asAdminPayload(value);
    if (!payload) throw new PermanentOutboxError();
    return deliverAdminApplicationAlert(payload, messageId);
  },
};

const ownerInvite: OutboxKindHandler = {
  capability: true,
  async deliver(value, messageId) {
    const payload = asInvitePayload(value);
    if (!payload) throw new PermanentOutboxError();
    return deliverOwnerInvite(payload, messageId);
  },
};

const paymentNotice: OutboxKindHandler = {
  capability: false,
  async deliver(value, messageId) {
    const payload = asPaymentNoticePayload(value);
    if (!payload) throw new PermanentOutboxError();
    return deliverPaymentNotice(payload, messageId);
  },
};

const loginCode: OutboxKindHandler = {
  // The code is a sign-in capability: the row is deleted after sending and retried only while it lasts.
  capability: true,
  shortLived: true,
  async deliver(value, messageId) {
    const payload = asLoginCodePayload(value);
    if (!payload) throw new PermanentOutboxError();
    return deliverLoginCode(payload, messageId);
  },
};

const loginAlert: OutboxKindHandler = {
  capability: false,
  async deliver(value, messageId) {
    const payload = asLoginAlertPayload(value);
    if (!payload) throw new PermanentOutboxError();
    return deliverLoginAlert(payload, messageId);
  },
};

const chatNotice: OutboxKindHandler = {
  capability: false,
  async deliver(value) {
    const payload = asChatPayload(value);
    if (!payload) throw new PermanentOutboxError();
    return deliverChatNotice(payload);
  },
};

/** Every email the platform can send. Add a kind here when a feature needs a new message. */
export const OUTBOX_KINDS = {
  "password-reset": passwordReset,
  "email-verification": emailVerification,
  "organisation-notice": organisationNotice,
  "organisation-application-alert": organisationApplicationAlert,
  "owner-invite": ownerInvite,
  "payment-notice": paymentNotice,
  "chat-notice": chatNotice,
  "login-code": loginCode,
  "login-alert": loginAlert,
} satisfies Record<string, OutboxKindHandler>;

export type OutboxKind = keyof typeof OUTBOX_KINDS;
