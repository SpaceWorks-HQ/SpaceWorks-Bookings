import "server-only";

import nodemailer, { type Transporter } from "nodemailer";
import { prisma } from "@/lib/db";
import { decryptOrgSecret } from "@/lib/orgSecrets";
import { assertPublicHost } from "@/lib/net/publicHost";
import { getEmailTransport } from "./transporter";

type Address = { name: string; address: string };

/** The bare address of a sender written as "Name <address>" or just "address". */
export function senderAddress(from: string) {
  return (from.match(/<([^>]+)>/)?.[1] ?? from).trim();
}

/** A transport for the organisation's own SMTP settings. Throws when the host isn't public. */
export async function organisationSmtpTransport(settings: { smtpHost: string; smtpPort: number; smtpSecure: boolean; smtpUser: string | null; password: string | null }) {
  await assertPublicHost(settings.smtpHost);
  const production = process.env.NODE_ENV === "production";
  return nodemailer.createTransport({
    host: settings.smtpHost, port: settings.smtpPort, secure: settings.smtpSecure,
    auth: settings.smtpUser && settings.password ? { user: settings.smtpUser, pass: settings.password } : undefined,
    requireTLS: production && !settings.smtpSecure,
    tls: production ? { minVersion: "TLSv1.2", rejectUnauthorized: true } : undefined,
    disableFileAccess: true, disableUrlAccess: true,
    connectionTimeout: 30_000, greetingTimeout: 30_000, socketTimeout: 60_000,
  });
}

/**
 * How an email on behalf of an organisation goes out: through its own SMTP when it has set one up and turned it
 * on, otherwise through the platform's, from the platform address but in the organisation's name, with replies
 * to the organisation's contact email.
 */
export async function organisationEmailTransport(organisationId: string): Promise<{ transporter: Transporter | null; from: Address | string; replyTo?: string }> {
  const [settings, org] = await Promise.all([
    prisma.orgEmailSettings.findUnique({ where: { organisationId } }),
    prisma.organisation.findUnique({ where: { id: organisationId }, select: { name: true, contactEmail: true } }),
  ]);
  if (settings?.enabled && settings.smtpHost && settings.fromAddress) {
    const password = settings.smtpPasswordEncrypted ? decryptOrgSecret(settings.smtpPasswordEncrypted, organisationId, "email") : null;
    return {
      transporter: await organisationSmtpTransport({ ...settings, smtpHost: settings.smtpHost, password }),
      from: { name: settings.fromName || org?.name || "", address: settings.fromAddress },
      replyTo: settings.replyTo ?? undefined,
    };
  }
  const platform = await getEmailTransport();
  return {
    transporter: platform.transporter,
    from: org ? { name: org.name, address: senderAddress(platform.from) } : platform.from,
    replyTo: org?.contactEmail ?? undefined,
  };
}
