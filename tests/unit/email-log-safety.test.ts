import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email/transporter", () => ({
  getEmailTransport: vi.fn().mockResolvedValue({
    transporter: null,
    from: "Space Works Organization <noreply@example.test>",
  }),
  assertEmailAccepted: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { organisation: { findUnique: vi.fn().mockResolvedValue({ name: "Private Org", slug: "private-org" }) } } }));

import { sendBrandedEmail } from "@/lib/email/message";
import { deliverOrganisationNotice, deliverOwnerInvite } from "@/lib/email/organisation";
import { sendEmailVerificationEmail } from "@/lib/email/emailVerification";
import { sendPasswordResetEmail } from "@/lib/email/passwordReset";

let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  log = vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  log.mockRestore();
});

describe("mock email log safety", () => {
  it("never logs recipients, message content, or bearer capabilities", async () => {
    const recipient = "private-member@example.test";
    const inviteToken = "secret-invite-token";
    const resetToken = "secret-reset-token";
    const verificationToken = "secret-verification-token";

    await sendBrandedEmail({ to: recipient, subject: "Hi", heading: "Private heading", paragraphs: ["Private body text"], action: { label: "Open", url: `https://members.example.test/x/${inviteToken}` } });
    await deliverOrganisationNotice({ to: recipient, organisationId: "org_1", notice: "rejected", reason: "Private reviewer note" }, "<m@x>");
    await deliverOwnerInvite({ to: recipient, organisationId: "org_1", token: inviteToken, expiresAt: new Date(Date.now() + 86_400_000).toISOString() }, "<m@x>");
    await sendPasswordResetEmail({ to: recipient, resetUrl: `https://members.example.test/reset-password?token=${resetToken}` });
    await sendEmailVerificationEmail({ to: recipient, verificationUrl: `https://members.example.test/verify-email?token=${verificationToken}` });

    const output = log.mock.calls.flat().join(" ");
    expect(output).not.toContain(recipient);
    expect(output).not.toContain("Private heading");
    expect(output).not.toContain("Private body text");
    expect(output).not.toContain("Private reviewer note");
    expect(output).not.toContain(inviteToken);
    expect(output).not.toContain(resetToken);
    expect(output).not.toContain(verificationToken);
  });
});
