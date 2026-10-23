"use server";

import { z } from "zod";
import { revalidatePath as nextRevalidatePath } from "next/cache";
import { trackedRevalidation } from "@/lib/frontend/revalidation";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { makerspaceActionAccess } from "@/lib/permissions";
import { decryptMakerspaceSecret, encryptMakerspaceSecret } from "@/lib/makerspaceSecrets";
import { assertPublicHost, PrivateHostError } from "@/lib/net/publicHost";
import { makerspaceSmtpTransport } from "@/lib/email/makerspaceTransport";
import { renderBrandedEmail } from "@/lib/email/message";
import { PaymentSecretsUnavailable } from "@/lib/payments/secrets";
import type { ActionResult } from "./makerspace";
import { flattenZodErrors } from "./utils";

const revalidatePath = trackedRevalidation(nextRevalidatePath);
const email = z.string().trim().toLowerCase().max(320).email("Enter an email address");
const optionalEmail = z.union([email, z.literal("")]).transform((value) => value || null);

const settingsSchema = z.object({
  makerspaceSlug: z.string().trim().min(1).max(64),
  enabled: z.boolean(),
  fromName: z.string().trim().max(120),
  fromAddress: email,
  replyTo: optionalEmail,
  smtpHost: z.string().trim().toLowerCase().min(3, "Enter the SMTP host").max(253).regex(/^[a-z0-9.-]+$/, "Enter a host name, without a scheme or port"),
  smtpPort: z.union([z.literal(25), z.literal(465), z.literal(587), z.literal(2525)]),
  smtpUser: z.string().trim().max(320).optional().transform((value) => value || null),
  /** Blank keeps the saved password. */
  smtpPassword: z.string().max(500).optional(),
});

async function access(slug: unknown) {
  const ctx = await makerspaceActionAccess(slug, "makerspace.settings");
  if (!ctx.ok) return ctx;
  if (await isActionRateLimited("action", ctx.userId)) return { ok: false as const, error: "Too many requests. Try again shortly." };
  return ctx;
}

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof PrivateHostError || error instanceof PaymentSecretsUnavailable) return { ok: false, error: error.message };
  throw error;
}

/** Save the makerspace's own SMTP relay and sender. Port 465 uses implicit TLS; the rest STARTTLS. */
export async function saveMakerspaceEmailSettings(input: unknown): Promise<ActionResult> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsed.error) };
  const ctx = await access(parsed.data.makerspaceSlug);
  if (!ctx.ok) return ctx;
  const { smtpPassword, ...rest } = parsed.data;
  const data = { enabled: rest.enabled, fromName: rest.fromName, fromAddress: rest.fromAddress, replyTo: rest.replyTo, smtpHost: rest.smtpHost, smtpPort: rest.smtpPort, smtpUser: rest.smtpUser };
  try {
    await assertPublicHost(data.smtpHost);
    const passwordUpdate = smtpPassword ? { smtpPasswordEncrypted: encryptMakerspaceSecret(smtpPassword, ctx.makerspace.id, "email") } : {};
    const values = { ...data, smtpSecure: data.smtpPort === 465, ...passwordUpdate, verifiedAt: null };
    await prisma.makerspaceEmailSettings.upsert({ where: { makerspaceId: ctx.makerspace.id }, create: { makerspaceId: ctx.makerspace.id, ...values }, update: values });
  } catch (error) {
    return failure(error);
  }
  await recordAuditEvent({ action: "MAKERSPACE_EMAIL_SETTINGS_SAVED", actorUserId: ctx.userId, makerspaceId: ctx.makerspace.id, targetType: "Makerspace", targetId: ctx.makerspace.id, metadata: { enabled: data.enabled, smtpHost: data.smtpHost, passwordChanged: Boolean(smtpPassword) } });
  revalidatePath(`/dashboard/${ctx.makerspace.slug}/settings/email`);
  return { ok: true };
}

/** Send a test message through the saved settings to the person testing, and mark them verified if it goes. */
export async function sendMakerspaceTestEmail(input: unknown): Promise<ActionResult> {
  const slug = z.object({ makerspaceSlug: z.string().trim().min(1).max(64) }).safeParse(input);
  if (!slug.success) return { ok: false, error: "Invalid request." };
  const ctx = await access(slug.data.makerspaceSlug);
  if (!ctx.ok) return ctx;
  const [settings, user] = await Promise.all([
    prisma.makerspaceEmailSettings.findUnique({ where: { makerspaceId: ctx.makerspace.id } }),
    prisma.user.findUnique({ where: { id: ctx.userId }, select: { email: true } }),
  ]);
  if (!settings?.smtpHost || !settings.fromAddress || !user?.email) return { ok: false, error: "Save the SMTP settings first." };
  try {
    const password = settings.smtpPasswordEncrypted ? decryptMakerspaceSecret(settings.smtpPasswordEncrypted, ctx.makerspace.id, "email") : null;
    const transporter = await makerspaceSmtpTransport({ ...settings, smtpHost: settings.smtpHost, password });
    const { html, text } = renderBrandedEmail({ subject: "", heading: "Test email", paragraphs: [`This came through ${ctx.makerspace.name}'s own email settings. Customer emails will be sent this way once they're switched on.`] });
    await transporter.sendMail({ from: { name: settings.fromName || ctx.makerspace.name, address: settings.fromAddress }, replyTo: settings.replyTo ?? undefined, to: user.email, subject: `${ctx.makerspace.name}: test email`, text, html });
  } catch (error) {
    if (error instanceof PrivateHostError || error instanceof PaymentSecretsUnavailable) return { ok: false, error: error.message };
    return { ok: false, error: "The SMTP server refused the test. Check the host, port, login and password." };
  }
  await prisma.makerspaceEmailSettings.update({ where: { makerspaceId: ctx.makerspace.id }, data: { verifiedAt: new Date() } });
  revalidatePath(`/dashboard/${ctx.makerspace.slug}/settings/email`);
  return { ok: true };
}
