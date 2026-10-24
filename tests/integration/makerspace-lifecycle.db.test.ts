import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({ current: { id: "", email: "" } }));
vi.mock("@/lib/auth", () => ({ auth: async () => (identity.current.id ? { user: identity.current } : null) }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/permissions")>()),
  // Here the platform admin is whoever is signed in.
  requireSuperAdmin: async () => ({ user: identity.current }),
}));

import { prisma } from "@/lib/db";
import { resubmitMakerspaceApplication, submitMakerspaceApplication } from "@/app/actions/makerspace-application";
import { createMakerspaceForOwner, reviewMakerspace } from "@/app/actions/super-admin-makerspaces";
import { createMakerspaceInvite } from "@/app/actions/makerspace-invites";
import { acceptMakerspaceInviteToken } from "@/lib/inviteAcceptance";

const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
const users = { applicant: { id: "", email: `applicant-${suffix}@example.test` }, admin: { id: "", email: `admin-${suffix}@example.test` }, unverified: { id: "", email: `unverified-${suffix}@example.test` }, owner: { id: "", email: `owner-${suffix}@example.test` } };
const createdMakerspaceIds: string[] = [];

const application = (overrides: Record<string, unknown> = {}) => ({
  name: "Kochi Runners Club",
  slug: `kochi-runners-${suffix}`,
  kind: "Sports club",
  description: "A running club for everyone in Kochi, with weekly group runs and races.",
  contactEmail: `club-${suffix}@example.test`,
  contactPhone: "",
  website: "",
  addressLine: "",
  city: "Kochi",
  stateCode: "KL",
  postalCode: "682001",
  ...overrides,
});

const signIn = (user: { id: string; email: string }) => {
  identity.current = user;
};

async function outboxFor(makerspaceId: string) {
  return prisma.$queryRaw<Array<{ kind: string; payload: Record<string, unknown> }>>`
    SELECT "kind", "payload" FROM "OutboxMessage" WHERE "payload"->>'makerspaceId' = ${makerspaceId} ORDER BY "createdAt" ASC`;
}

beforeAll(async () => {
  for (const [key, user] of Object.entries(users)) {
    const created = await prisma.user.create({
      data: { email: user.email, emailVerified: key === "unverified" ? null : new Date(), isSuperAdmin: key === "admin", mfaEnabledAt: new Date() },
    });
    user.id = created.id;
  }
});

afterAll(async () => {
  if (createdMakerspaceIds.length) {
    await prisma.$executeRaw`DELETE FROM "OutboxMessage" WHERE "payload"->>'makerspaceId' = ANY(${createdMakerspaceIds})`;
    await prisma.makerspace.deleteMany({ where: { id: { in: createdMakerspaceIds } } });
  }
  await prisma.auditEvent.deleteMany({ where: { actorUserId: { in: Object.values(users).map((user) => user.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users).map((user) => user.id) } } });
  await prisma.$disconnect();
});

describe.sequential("makerspace application lifecycle", () => {
  let makerspaceId = "";
  const slug = `kochi-runners-${suffix}`;

  it("refuses an applicant whose email is not verified", async () => {
    signIn(users.unverified);
    const result = await submitMakerspaceApplication(application({ slug: `unverified-${suffix}` }));
    expect(result.ok).toBe(false);
    expect(await prisma.makerspace.count({ where: { slug: `unverified-${suffix}` } })).toBe(0);
  });

  it("creates a pending makerspace owned by the applicant, with history and emails", async () => {
    signIn(users.applicant);
    const result = await submitMakerspaceApplication(application());
    expect(result).toEqual({ ok: true, data: { slug } });
    const makerspace = await prisma.makerspace.findUniqueOrThrow({ where: { slug }, include: { teamMembers: true, reviews: true } });
    makerspaceId = makerspace.id;
    createdMakerspaceIds.push(makerspace.id);
    expect(makerspace.status).toBe("PENDING_REVIEW");
    expect(makerspace.source).toBe("SELF_SIGNUP");
    expect(makerspace.stateCode).toBe("KL");
    expect(makerspace.teamMembers).toEqual([expect.objectContaining({ userId: users.applicant.id, role: "BOOKINGS_MANAGER" })]);
    expect(makerspace.reviews).toEqual([expect.objectContaining({ action: "SUBMITTED", actorUserId: users.applicant.id, applicationSnapshot: expect.objectContaining({ name: "Kochi Runners Club", slug }) })]);
    const messages = await outboxFor(makerspace.id);
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "makerspace-notice", payload: expect.objectContaining({ to: users.applicant.email, notice: "received" }) }),
      expect.objectContaining({ kind: "makerspace-application-alert", payload: expect.objectContaining({ to: users.admin.email }) }),
    ]));
  });

  it("refuses a second application for a taken address", async () => {
    signIn(users.owner);
    const result = await submitMakerspaceApplication(application());
    expect(result).toMatchObject({ ok: false, fieldErrors: { slug: ["That web address is taken"] } });
  });

  it("keeps the team out of everything but the application before approval", async () => {
    signIn(users.applicant);
    const invite = await createMakerspaceInvite({ makerspaceSlug: slug, role: "VIEWER" });
    expect(invite.ok).toBe(false);
  });

  it("needs a note to ask for changes, then tells the owners", async () => {
    signIn(users.admin);
    expect(await reviewMakerspace({ makerspaceId: makerspaceId, decision: "request-changes" })).toMatchObject({ ok: false });
    expect(await reviewMakerspace({ makerspaceId: makerspaceId, decision: "request-changes", reason: "Add your PIN code and full address." })).toEqual({ ok: true });
    expect((await prisma.makerspace.findUniqueOrThrow({ where: { id: makerspaceId } })).status).toBe("CHANGES_REQUESTED");
    const notices = (await outboxFor(makerspaceId)).filter((message) => message.kind === "makerspace-notice");
    expect(notices.at(-1)?.payload).toMatchObject({ notice: "changes-requested", reason: "Add your PIN code and full address." });
  });

  it("lets the owner fix and resend, back into review", async () => {
    signIn(users.applicant);
    const result = await resubmitMakerspaceApplication({ ...application({ addressLine: "12 Marine Drive" }), makerspaceSlug: slug });
    expect(result).toEqual({ ok: true });
    const makerspace = await prisma.makerspace.findUniqueOrThrow({ where: { id: makerspaceId }, include: { reviews: { orderBy: { createdAt: "desc" }, take: 1 } } });
    expect(makerspace.status).toBe("PENDING_REVIEW");
    expect(makerspace.addressLine).toBe("12 Marine Drive");
    expect(makerspace.reviews[0]).toMatchObject({ action: "RESUBMITTED" });
    // Already back in review: a second resend is refused.
    expect((await resubmitMakerspaceApplication({ ...application(), makerspaceSlug: slug })).ok).toBe(false);
  });

  it("approves once, and refuses a stale second decision", async () => {
    signIn(users.admin);
    expect(await reviewMakerspace({ makerspaceId: makerspaceId, decision: "approve" })).toEqual({ ok: true });
    expect((await prisma.makerspace.findUniqueOrThrow({ where: { id: makerspaceId } })).status).toBe("ACTIVE");
    expect(await reviewMakerspace({ makerspaceId: makerspaceId, decision: "approve" })).toMatchObject({ ok: false });
    expect(await reviewMakerspace({ makerspaceId: makerspaceId, decision: "reject", reason: "late" })).toMatchObject({ ok: false });
  });

  it("opens team management once approved, and closes it again when suspended", async () => {
    signIn(users.applicant);
    expect((await createMakerspaceInvite({ makerspaceSlug: slug, role: "FRONT_DESK" })).ok).toBe(true);
    signIn(users.admin);
    expect(await reviewMakerspace({ makerspaceId: makerspaceId, decision: "suspend", reason: "Unpaid hosting invoice." })).toEqual({ ok: true });
    signIn(users.applicant);
    expect((await createMakerspaceInvite({ makerspaceSlug: slug, role: "FRONT_DESK" })).ok).toBe(false);
    signIn(users.admin);
    expect(await reviewMakerspace({ makerspaceId: makerspaceId, decision: "reactivate" })).toEqual({ ok: true });
  });

  it("releases a declined makerspace's address only after 30 days", async () => {
    signIn(users.owner);
    const declinedSlug = `declined-club-${suffix}`;
    expect((await submitMakerspaceApplication(application({ slug: declinedSlug }))).ok).toBe(true);
    const declined = await prisma.makerspace.findUniqueOrThrow({ where: { slug: declinedSlug } });
    createdMakerspaceIds.push(declined.id);
    signIn(users.admin);
    expect(await reviewMakerspace({ makerspaceId: declined.id, decision: "reject", reason: "Not a makerspace." })).toEqual({ ok: true });

    signIn(users.applicant);
    expect((await submitMakerspaceApplication(application({ slug: declinedSlug }))).ok).toBe(false);
    await prisma.$executeRaw`UPDATE "Makerspace" SET "updatedAt" = now() - interval '31 days' WHERE "id" = ${declined.id}`;
    const retry = await submitMakerspaceApplication(application({ slug: declinedSlug }));
    expect(retry).toEqual({ ok: true, data: { slug: declinedSlug } });
    const fresh = await prisma.makerspace.findUniqueOrThrow({ where: { slug: declinedSlug } });
    createdMakerspaceIds.push(fresh.id);
    expect(fresh.id).not.toBe(declined.id);
    expect((await prisma.makerspace.findUniqueOrThrow({ where: { id: declined.id } })).slug).toBe(`declined-${declined.id}`);
  });
});

describe.sequential("platform admin tools", () => {
  it("creates an active makerspace whose owner joins by an email-bound invite", async () => {
    signIn(users.admin);
    const result = await createMakerspaceForOwner({ ...application({ slug: `direct-${suffix}`, name: "Direct Club" }), ownerEmail: users.owner.email });
    expect(result.ok).toBe(true);
    const makerspaceId = result.ok ? result.data!.makerspaceId : "";
    createdMakerspaceIds.push(makerspaceId);
    const makerspace = await prisma.makerspace.findUniqueOrThrow({ where: { id: makerspaceId }, include: { reviews: true, teamInvites: true, teamMembers: true } });
    expect(makerspace).toMatchObject({ status: "ACTIVE", source: "SUPERADMIN" });
    expect(makerspace.reviews).toEqual([expect.objectContaining({ action: "CREATED" })]);
    expect(makerspace.teamMembers).toEqual([]);
    const [invite] = makerspace.teamInvites;
    expect(invite).toMatchObject({ role: "BOOKINGS_MANAGER", email: users.owner.email });
    expect((await outboxFor(makerspaceId)).map((message) => message.kind)).toEqual(["owner-invite"]);

    expect(await acceptMakerspaceInviteToken(invite.token, { id: users.applicant.id, email: users.applicant.email, emailVerified: true })).toEqual({ ok: false, reason: "wrong-account" });
    expect(await acceptMakerspaceInviteToken(invite.token, { id: users.owner.id, email: users.owner.email, emailVerified: true })).toEqual({ ok: true, href: `/dashboard/direct-${suffix}` });
    expect(await prisma.teamMember.findFirst({ where: { makerspaceId, userId: users.owner.id } })).toMatchObject({ role: "BOOKINGS_MANAGER" });
  });

});
