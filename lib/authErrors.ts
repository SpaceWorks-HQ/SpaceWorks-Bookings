import { CredentialsSignin } from "next-auth";

/**
 * Sign-in outcomes the login screen shows as their own step or message. Each `code` reaches the browser, so
 * none of them may reveal whether an arbitrary email address has an account.
 */

/** Returned only after the password (or sign-in link) was valid: ask for the authenticator next. */
export class MfaRequiredError extends CredentialsSignin {
  code = "mfa_required";
}

export class EmailVerificationRequiredError extends CredentialsSignin {
  code = "email_verification_required";
}

/** A sign-in from a new browser on an account without an authenticator: a code has been emailed. */
export class EmailCodeRequiredError extends CredentialsSignin {
  code = "email_code_required";
}

/** Too many failed sign-ins from this address: it is blocked for a while (lib/ipBlock.ts). */
export class AddressBlockedError extends CredentialsSignin {
  code = "address_blocked";
}

/** The emailed sign-in link is unknown, expired or already used. */
export class MagicLinkInvalidError extends CredentialsSignin {
  code = "magic_link_invalid";
}

/** Super admins sign in with their email and the password set on the server, never by link. */
export class SuperAdminPasswordOnlyError extends CredentialsSignin {
  code = "super_admin_password_only";
}
