import "server-only";

import { sendBrandedEmail } from "./message";

/** The emailed sign-in link. Platform email; the link is a bearer credential and is never logged. */
export async function sendMagicLinkEmail(params: { to: string; url: string; messageId?: string }) {
  await sendBrandedEmail({
    to: params.to,
    messageId: params.messageId,
    subject: "Your Space Works Bookings sign-in link",
    heading: "Sign in to Space Works Bookings",
    paragraphs: [
      "Use the button below to sign in. The link works once, for 15 minutes. If your account has an authenticator app, you'll be asked for a code too.",
      "If you didn't ask for this link, you can ignore this email. Nobody can sign in without opening it.",
    ],
    action: { label: "Sign in", url: params.url },
  });
}
