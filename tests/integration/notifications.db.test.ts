import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { at, createPaymentsOrg, ensurePaymentKey, people, removePaymentsOrg, unpaidTerm } from "./payments-helpers";

// Pay links and the portal never need a session here.
vi.mock("@/lib/auth", () => ({ auth: async () => null }));

ensurePaymentKey();
process.env.AUTH_SECRET ??= "integration-secret-integration-secret-42";

const { prisma } = await import("@/lib/db");
const { encryptOrgSecret } = await import("@/lib/orgSecrets");
const { recordOfflinePayment } = await import("@/lib/payments/offline");
const { deliverChatNotice, asChatPayload } = await import("@/lib/chat/notify");
const { organisationEmailTransport } = await import("@/lib/email/orgTransport");
const { findOwnMember } = await import("@/lib/portal/member");
const { payLinkTerm } = await import("@/lib/payments/memberAccess");
const { payLinkToken } = await import("@/lib/payments/payLink");
const { lookupVerification } = await import("@/lib/cards/verifyLookup");

type Ctx = Awaited<ReturnType<typeof createPaymentsOrg>>;
let org: Ctx["org"];
let plan: Ctx["plan"];
let staff: Array<{ id: string }>;
const paidOn = at("2026-06-15T06:00:00Z");
const webhookUrl = "https://hooks.slack.com/services/T0000000/B0000000/abcdefghijklmnopqrstuvwx";

async function slackChannel(events: string[], includeNames = false) {
  return prisma.chatChannel.create({ data: { organisationId: org.id, kind: "SLACK", name: "Treasurers", events, includeNames, target: "Slack webhook", configEncrypted: encryptOrgSecret(JSON.stringify({ webhookUrl }), org.id, "chat") } });
}

async function paidMember(name: string) {
  const term = await unpaidTerm(org, plan, name, paidOn);
  const { payment } = await prisma.$transaction((tx) => recordOfflinePayment(tx, { org, termId: term.id, method: "cash", actorUserId: staff[0].id, now: paidOn }));
  return { term, payment };
}

beforeAll(async () => {
  ({ org, plan } = await createPaymentsOrg());
  await prisma.organisation.update({ where: { id: org.id }, data: { contactEmail: "office@kunj.example" } });
  staff = await people(1);
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  if (org) {
    await prisma.memberCard.deleteMany({ where: { organisationId: org.id } }).catch(() => undefined);
    await removePaymentsOrg(org.id, staff.map((person) => person.id));
  }
  await prisma.$disconnect();
});

describe.sequential("chat alerts", () => {
  it("queue a payment alert for channels that asked for it, and post it without the member's name", async () => {
    const channel = await slackChannel(["payment"]);
    const quiet = await slackChannel(["application"]);
    const { payment } = await paidMember("navya");
    const queued = await prisma.outboxMessage.findMany({ where: { kind: "chat-notice", payload: { path: ["organisationId"], equals: org.id } } });
    expect(queued.map((row) => (row.payload as { channelId: string }).channelId)).toEqual([channel.id]);
    expect(queued.some((row) => (row.payload as { channelId: string }).channelId === quiet.id)).toBe(false);

    const posts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { posts.push(String(init.body)); return new Response("ok"); }));
    expect(await deliverChatNotice(asChatPayload(queued[0].payload)!)).toBe("sent");
    const text = JSON.parse(posts[0]).text as string;
    expect(text).toContain("payment received");
    expect(text).toMatch(/member no\. \d+/);
    expect(text).not.toContain("navya");
    expect(text).toContain(`/payments/${payment.id}`);
    expect((await prisma.chatChannel.findUniqueOrThrow({ where: { id: channel.id } })).lastDeliveredAt).not.toBeNull();
  });

  it("switch a channel off when the provider says it is gone", async () => {
    const channel = await slackChannel(["payment"]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no_service", { status: 404 })));
    const { payment } = await paidMember("ozhi");
    expect(await deliverChatNotice({ channelId: channel.id, organisationId: org.id, event: "payment", refs: { paymentId: payment.id } })).toBe("dropped");
    expect(await prisma.chatChannel.findUniqueOrThrow({ where: { id: channel.id } })).toMatchObject({ enabled: false, failures: 1 });
  });
});

describe.sequential("organisation email", () => {
  it("falls back to the platform sender in the organisation's name, with replies to its contact address", async () => {
    const transport = await organisationEmailTransport(org.id);
    expect(transport.from).toMatchObject({ name: "Kunj-Company" });
    expect(transport.replyTo).toBe("office@kunj.example");
  });

  it("uses the organisation's own sender once its SMTP is set up and on", async () => {
    await prisma.orgEmailSettings.create({ data: { organisationId: org.id, enabled: true, fromName: "Kunj Office", fromAddress: "hello@kunj.example", replyTo: "desk@kunj.example", smtpHost: "localhost", smtpPort: 587, smtpUser: "relay", smtpPasswordEncrypted: encryptOrgSecret("relay-pass", org.id, "email") } });
    const transport = await organisationEmailTransport(org.id);
    expect(transport.from).toEqual({ name: "Kunj Office", address: "hello@kunj.example" });
    expect(transport.replyTo).toBe("desk@kunj.example");
    expect(transport.transporter).not.toBeNull();
  });
});

describe.sequential("organisations without member accounts", () => {
  it("hide the portal, still open pay links, and still verify cards", async () => {
    const { term } = await paidMember("pooja");
    const account = await prisma.user.create({ data: { email: `pooja-${org.id.slice(-6)}@example.test`, emailVerified: new Date() } });
    await prisma.member.update({ where: { id: term.memberId }, data: { email: account.email! } });
    expect(await findOwnMember(account.id, org.slug)).not.toBeNull();

    await prisma.organisation.update({ where: { id: org.id }, data: { memberPortal: false } });
    expect(await findOwnMember(account.id, org.slug)).toBeNull();
    expect((await payLinkTerm(payLinkToken(term.id)))?.term.id).toBe(term.id);
    expect(await payLinkTerm(`${payLinkToken(term.id)}0`)).toBeNull();

    const card = await prisma.memberCard.findFirstOrThrow({ where: { organisationId: org.id, memberId: term.memberId } });
    expect((await lookupVerification(card.verifyToken, at("2026-07-01T06:00:00Z"))).state).toBe("member");
    await prisma.user.delete({ where: { id: account.id } });
  });
});
