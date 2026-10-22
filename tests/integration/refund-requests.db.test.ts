import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { at, createPaymentsOrg, ensurePaymentKey, people, removePaymentsOrg, unpaidTerm } from "./payments-helpers";

ensurePaymentKey();

const { prisma } = await import("@/lib/db");
const { ensurePaymentSettings } = await import("@/lib/payments/config");
const { recordOfflinePayment } = await import("@/lib/payments/offline");
const { createRefund } = await import("@/lib/payments/refunds");
const { afterDirectRefund, approveRefundRequest, declineRefundRequest, requestRefund, withdrawRefundRequest } = await import("@/lib/payments/refundRequests");

type Ctx = Awaited<ReturnType<typeof createPaymentsOrg>>;
let org: Ctx["org"];
let plan: Ctx["plan"];
let staff: Array<{ id: string }>;
const paidOn = at("2026-06-15T06:00:00Z");
const fiveDaysLater = at("2026-06-20T06:00:00Z");

async function policy(refundPolicy: "NONE" | "FULL" | "PRO_RATA", refundWindowDays = 14) {
  await prisma.orgPaymentSettings.update({ where: { organisationId: org.id }, data: { refundPolicy, refundWindowDays } });
}

/** A member who paid ₹1,180 in cash on 15 June for an annual membership that is now running. */
async function paidMember(name: string) {
  const term = await unpaidTerm(org, plan, name, paidOn);
  const { payment } = await prisma.$transaction((tx) => recordOfflinePayment(tx, { org, termId: term.id, method: "cash", actorUserId: staff[0].id, now: paidOn }));
  return { term, payment };
}

const ask = (term: { id: string; memberId: string }, now = fiveDaysLater) =>
  prisma.$transaction((tx) => requestRefund(tx, { org, memberId: term.memberId, termId: term.id, reason: "Moving abroad", userId: staff[1].id, now }));

beforeAll(async () => {
  ({ org, plan } = await createPaymentsOrg());
  await ensurePaymentSettings(org.id);
  staff = await people(2);
});

afterAll(async () => {
  if (org) await removePaymentsOrg(org.id, staff.map((person) => person.id));
  await prisma.$disconnect();
});

describe.sequential("refund requests", () => {
  it("are refused under a no-refunds policy and after the window", async () => {
    const { term } = await paidMember("aleena");
    await policy("NONE");
    await expect(ask(term)).rejects.toThrow(/isn't eligible/);
    await policy("FULL", 3);
    await expect(ask(term)).rejects.toThrow(/isn't eligible/);
  });

  it("refund in full and end the membership when approved, once", async () => {
    await policy("FULL");
    const { term, payment } = await paidMember("binoy");
    const request = await ask(term);
    expect(request).toMatchObject({ status: "OPEN", suggestedMinor: 118_000, currency: "INR" });
    await expect(ask(term)).rejects.toThrow(/already asked/);
    expect(await prisma.outboxMessage.count({ where: { kind: "refund-notice", payload: { path: ["requestId"], equals: request.id } } })).toBe(1);

    const { created, ended } = await prisma.$transaction((tx) => approveRefundRequest(tx, { org, requestId: request.id, amountMinor: 118_000, endMembership: true, actorUserId: staff[0].id, now: fiveDaysLater }));
    expect(ended).toBe(true);
    expect(created.refund).toMatchObject({ status: "PROCESSED", amountMinor: 118_000 });
    expect(await prisma.taxDocument.findUniqueOrThrow({ where: { refundId: created.refund.id } })).toMatchObject({ kind: "CREDIT_NOTE", totalMinor: 118_000 });
    expect(await prisma.refundRequest.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ status: "APPROVED", refundId: created.refund.id, decidedById: staff[0].id });
    expect((await prisma.membershipTerm.findUniqueOrThrow({ where: { id: term.id } })).status).toBe("CANCELLED");

    await expect(prisma.$transaction((tx) => declineRefundRequest(tx, { org, requestId: request.id, note: "Changed my mind", actorUserId: staff[0].id }))).rejects.toThrow(/already dealt with/);
    await expect(prisma.refundRequest.update({ where: { id: request.id }, data: { status: "DECLINED" } })).rejects.toThrow();
    await expect(prisma.refundRequest.delete({ where: { id: request.id } })).rejects.toThrow();
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "PAID" });
  });

  it("offer only the unused share of the membership fee, and a declined member may ask again", async () => {
    await policy("PRO_RATA", 120);
    const { term } = await paidMember("chinnu");
    // The unused share of the term (it runs to the end of the financial year) of the ₹1,180 membership fee.
    const asked = at("2026-08-27T06:00:00Z");
    const { startsAt, endsAt } = await prisma.membershipTerm.findUniqueOrThrow({ where: { id: term.id } });
    const share = (endsAt!.getTime() - asked.getTime()) / (endsAt!.getTime() - startsAt!.getTime());
    const request = await ask(term, asked);
    expect(request.suggestedMinor).toBe(Math.floor(118_000 * share));
    expect(request.suggestedMinor).toBeGreaterThan(0);
    expect(request.suggestedMinor).toBeLessThan(118_000);

    await prisma.$transaction((tx) => declineRefundRequest(tx, { org, requestId: request.id, note: "Past the trial month", actorUserId: staff[0].id, now: at("2026-08-28T06:00:00Z") }));
    expect(await prisma.refundRequest.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ status: "DECLINED", decisionNote: "Past the trial month" });
    expect((await prisma.membershipTerm.findUniqueOrThrow({ where: { id: term.id } })).status).toBe("ACTIVE");
    expect((await ask(term, at("2026-08-29T06:00:00Z"))).status).toBe("OPEN");
  });

  it("can be withdrawn by the member who asked, and no one else", async () => {
    await policy("FULL");
    const { term } = await paidMember("dilsha");
    const other = await paidMember("eby");
    const request = await ask(term);
    await expect(prisma.$transaction((tx) => withdrawRefundRequest(tx, { org, memberId: other.term.memberId, requestId: request.id, userId: staff[1].id }))).rejects.toThrow(/not found/);
    await prisma.$transaction((tx) => withdrawRefundRequest(tx, { org, memberId: term.memberId, requestId: request.id, userId: staff[1].id }));
    expect((await prisma.refundRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("WITHDRAWN");
    expect((await prisma.membershipTerm.findUniqueOrThrow({ where: { id: term.id } })).status).toBe("ACTIVE");
  });

  it("are closed by a refund made straight from the payment page, which can also end the membership", async () => {
    await policy("FULL");
    const { term, payment } = await paidMember("fathima");
    const request = await ask(term);
    await prisma.$transaction(async (tx) => {
      const { refund } = await createRefund(tx, { org, paymentId: payment.id, amountMinor: 50_000, reason: "Partial, agreed by phone", actorUserId: staff[0].id, now: fiveDaysLater });
      await afterDirectRefund(tx, { org, paymentId: payment.id, termId: term.id, refundId: refund.id, endMembership: true, actorUserId: staff[0].id, now: fiveDaysLater });
    });
    expect(await prisma.refundRequest.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ status: "APPROVED", decisionNote: "Refunded from the payment page." });
    expect((await prisma.membershipTerm.findUniqueOrThrow({ where: { id: term.id } })).status).toBe("CANCELLED");
    await expect(ask(term)).rejects.toThrow(/can't be cancelled/);
  });
});
