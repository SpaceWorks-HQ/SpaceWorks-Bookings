import { afterEach, describe, expect, it, vi } from "vitest";

const mail = vi.hoisted(() => ({ reset: vi.fn(), verify: vi.fn(), magic: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/email/passwordReset", () => ({ sendPasswordResetEmail: mail.reset }));
vi.mock("@/lib/email/emailVerification", () => ({ sendEmailVerificationEmail: mail.verify }));
vi.mock("@/lib/email/magicLink", () => ({ sendMagicLinkEmail: mail.magic }));

import { isSafeMessageUrl, OUTBOX_KINDS } from "@/lib/outboxKinds";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

function production(overrides: Record<string, string> = {}) {
  for (const [key, value] of Object.entries({ NODE_ENV: "production", NEXT_PUBLIC_BASE_URL: "http://bookings.example.test:8080", AUTH_URL: "http://bookings.example.test:8080", ALLOW_PLAIN_HTTP: "0", CI: "false", ALLOW_INSECURE_PRODUCTION_TESTS: "0", ...overrides })) vi.stubEnv(key, value);
}

describe("outbox links for the supported plain HTTP install", () => {
  it.each([
    ["default HTTPS", {}, "https://bookings.example.test/reset?token=example", true],
    ["HTTP disabled", {}, "http://bookings.example.test:8080/reset", false],
    ["own configured HTTP origin", { ALLOW_PLAIN_HTTP: "1" }, "http://bookings.example.test:8080/reset?token=example", true],
    ["foreign HTTP host", { ALLOW_PLAIN_HTTP: "1" }, "http://foreign.example.test:8080/reset", false],
    ["different HTTP port", { ALLOW_PLAIN_HTTP: "1" }, "http://bookings.example.test/reset", false],
    ["HTTP credentials", { ALLOW_PLAIN_HTTP: "1" }, "http://user:pass@bookings.example.test:8080/reset", false],
    ["HTTPS credentials", {}, "https://user:pass@bookings.example.test/reset", false],
    ["other protocol", { ALLOW_PLAIN_HTTP: "1" }, "javascript:alert(1)", false],
    ["configured secure origin", { ALLOW_PLAIN_HTTP: "1", NEXT_PUBLIC_BASE_URL: "https://bookings.example.test" }, "http://bookings.example.test/reset", false],
    ["CI flag alone", { CI: "true" }, "http://bookings.example.test:8080/reset", false],
    ["test flag alone", { ALLOW_INSECURE_PRODUCTION_TESTS: "1" }, "http://bookings.example.test:8080/reset", false],
    ["guarded CI own origin", { CI: "true", ALLOW_INSECURE_PRODUCTION_TESTS: "1" }, "http://bookings.example.test:8080/reset", true],
    ["guarded CI foreign origin", { CI: "true", ALLOW_INSECURE_PRODUCTION_TESTS: "1" }, "http://foreign.example.test/reset", false],
    ["malformed configured URL", { ALLOW_PLAIN_HTTP: "1", NEXT_PUBLIC_BASE_URL: "invalid" }, "http://bookings.example.test:8080/reset", false],
    ["credentialed configured origin", { ALLOW_PLAIN_HTTP: "1", NEXT_PUBLIC_BASE_URL: "http://user:pass@bookings.example.test:8080" }, "http://bookings.example.test:8080/reset", false],
  ] as const)("validates %s", (_name, overrides, url, allowed) => {
    production(overrides);
    expect(isSafeMessageUrl(url)).toBe(allowed);
  });

  it("allows local development HTTP links", () => {
    production({ NODE_ENV: "development" });
    expect(isSafeMessageUrl("http://localhost:3000/reset")).toBe(true);
  });

  it.each([
    ["password-reset", "resetUrl", "reset"],
    ["email-verification", "verificationUrl", "verify"],
    ["magic-link", "url", "magic"],
  ] as const)("delivers a valid %s capability for the configured plain HTTP install", async (kind, field, sender) => {
    production({ ALLOW_PLAIN_HTTP: "1" });
    const url = "http://bookings.example.test:8080/continue?token=synthetic";
    await expect(OUTBOX_KINDS[kind].deliver({ to: "person@example.test", [field]: url, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }, "<stable@outbox.invalid>")).resolves.toBe("sent");
    expect(mail[sender]).toHaveBeenCalledWith(expect.objectContaining({ to: "person@example.test", [field]: url, messageId: "<stable@outbox.invalid>" }));
  });
});
