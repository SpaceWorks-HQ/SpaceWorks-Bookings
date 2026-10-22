import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
let makerspaceId: string;
let userId: string;

describe.sequential("production database invariants", () => {
  beforeAll(async () => {
    const makerspace = await prisma.makerspace.create({
      data: { name: "Schema invariant makerspace", slug: `schema-invariants-${suffix}` },
    });
    makerspaceId = makerspace.id;
    userId = (await prisma.user.create({ data: { email: `schema-user-${suffix}@example.test` } })).id;
  });

  afterAll(async () => {
    if (makerspaceId) await prisma.makerspace.deleteMany({ where: { id: makerspaceId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("rejects malformed makerspace addresses, months, limits and currencies", async () => {
    const make = (data: Record<string, unknown>) =>
      prisma.makerspace.create({ data: { name: "Bad", slug: `bad-${suffix}`, ...data } });
    await expect(make({ slug: `Bad_Slug_${suffix}` })).rejects.toThrow();
    await expect(make({ financialYearStartMonth: 13 })).rejects.toThrow();
    await expect(make({ financialYearStartMonth: 0 })).rejects.toThrow();
    await expect(make({ memberLimit: 0 })).rejects.toThrow();
    await expect(make({ managerLimit: -1 })).rejects.toThrow();
    await expect(make({ currency: "inr" })).rejects.toThrow();
  });

  it("allows one team row per person per makerspace", async () => {
    await prisma.teamMember.create({ data: { userId, makerspaceId, role: "OWNER" } });
    await expect(prisma.teamMember.create({ data: { userId, makerspaceId, role: "VIEWER" } })).rejects.toThrow();
  });

  it("requires a note on refusals and change requests", async () => {
    await expect(prisma.makerspaceReview.create({ data: { makerspaceId, action: "REJECTED" } })).rejects.toThrow();
    await expect(prisma.makerspaceReview.create({ data: { makerspaceId, action: "CHANGES_REQUESTED", reason: "   " } })).rejects.toThrow();
    await expect(prisma.makerspaceReview.create({ data: { makerspaceId, action: "CHANGES_REQUESTED", reason: "Add your address" } })).resolves.toBeTruthy();
    await expect(prisma.makerspaceReview.create({ data: { makerspaceId, action: "APPROVED" } })).resolves.toBeTruthy();
  });

  it("records who used an invite only together with when", async () => {
    await expect(prisma.teamInvite.create({ data: { makerspaceId, token: `t-${suffix}-1`, usedByUserId: userId } })).rejects.toThrow();
    await expect(prisma.teamInvite.create({ data: { makerspaceId, token: `t-${suffix}-2`, usedByUserId: userId, usedAt: new Date() } })).resolves.toBeTruthy();
  });

  it("rejects impossible outbox states and negative attempts", async () => {
    await expect(prisma.outboxMessage.create({ data: { kind: "makerspace-notice", payload: {}, status: "SENT", sentAt: null } })).rejects.toThrow();
    await expect(prisma.outboxMessage.create({ data: { kind: "makerspace-notice", payload: {}, status: "PROCESSING" } })).rejects.toThrow();
    await expect(prisma.outboxMessage.create({ data: { kind: "makerspace-notice", payload: {}, attempts: -1 } })).rejects.toThrow();
  });

  it("removes a makerspace's team, invites and review history with it", async () => {
    const makerspace = await prisma.makerspace.create({ data: { name: "Cascade", slug: `cascade-${suffix}` } });
    await prisma.teamMember.create({ data: { userId, makerspaceId: makerspace.id, role: "OWNER" } });
    await prisma.teamInvite.create({ data: { makerspaceId: makerspace.id, token: `cascade-${suffix}` } });
    await prisma.makerspaceReview.create({ data: { makerspaceId: makerspace.id, action: "SUBMITTED" } });
    await prisma.makerspace.delete({ where: { id: makerspace.id } });
    expect(await prisma.teamMember.count({ where: { makerspaceId: makerspace.id } })).toBe(0);
    expect(await prisma.teamInvite.count({ where: { makerspaceId: makerspace.id } })).toBe(0);
    expect(await prisma.makerspaceReview.count({ where: { makerspaceId: makerspace.id } })).toBe(0);
  });
});
