import * as OTPAuth from "otpauth";

/**
 * Authenticator codes for the demo staff, who share DEMO_MFA_SECRET. The app accepts each 30-second step once
 * per secret (and one step either side), so every sign-in in this worker takes the next unused step, waiting
 * when it would run ahead of the clock.
 */
let lastStep = 0;

export async function nextTotp(secret: string) {
  const nowStep = Math.floor(Date.now() / 30_000);
  const step = Math.max(lastStep + 1, nowStep - 1);
  if (step > nowStep + 1) await new Promise((resolve) => setTimeout(resolve, (step - 1) * 30_000 - Date.now() + 1_000));
  lastStep = step;
  return new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) }).generate({ timestamp: step * 30_000 + 1_000 });
}
