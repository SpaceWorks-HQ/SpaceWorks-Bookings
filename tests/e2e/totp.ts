import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as OTPAuth from "otpauth";

/**
 * Authenticator codes for the demo staff, who share DEMO_MFA_SECRET. The app accepts each 30-second step once
 * per secret (and one step either side), so every sign-in takes the next unused step, waiting when it would run
 * ahead of the clock. The last step used is kept in a file, not in memory: Playwright starts a fresh worker after a
 * failure, and that worker must not reuse a step the previous one just spent.
 */
function stateFile(secret: string) {
  return path.join(tmpdir(), `swb-e2e-totp-${createHash("sha256").update(secret).digest("hex").slice(0, 12)}.json`);
}

function lastStep(secret: string): number {
  try {
    return Number(JSON.parse(readFileSync(stateFile(secret), "utf8")).step) || 0;
  } catch {
    return 0;
  }
}

export async function nextTotp(secret: string) {
  const nowStep = Math.floor(Date.now() / 30_000);
  const step = Math.max(lastStep(secret) + 1, nowStep - 1);
  if (step > nowStep + 1) await new Promise((resolve) => setTimeout(resolve, (step - 1) * 30_000 - Date.now() + 1_000));
  writeFileSync(stateFile(secret), JSON.stringify({ step }));
  return new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) }).generate({ timestamp: step * 30_000 + 1_000 });
}
