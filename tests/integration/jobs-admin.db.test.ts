import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const context = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => (context.userId ? { user: { id: context.userId } } : null)) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: vi.fn(async () => false) }));

import { prisma } from "@/lib/db";
import { manageJobsAction } from "@/app/actions/jobs";
import { loadSuperAdminJobsView } from "@/lib/views/app__super-admin__jobs__page";
import { closeQueues, getQueues } from "@/lib/queue/client";

const suffix = randomUUID().slice(0, 8);
const domain = `@jobs-${suffix}.test`;
let adminId = "";
let ownerId = "";
let makerspaceId = "";

describe.sequential("instance queue authorisation", () => {
  beforeAll(async () => {
    vi.stubEnv("REDIS_URL", process.env.TEST_QUEUE_REDIS_URL || "redis://127.0.0.1:6379/0");
    vi.stubEnv("JOBS_QUEUE_PREFIX", `swb:test:admin:${suffix}`);
    adminId = (await prisma.user.create({ data: { email: `admin${domain}`, emailVerified: new Date(), isSuperAdmin: true, mfaEnabledAt: new Date() } })).id;
    ownerId = (await prisma.user.create({ data: { email: `owner${domain}`, emailVerified: new Date(), mfaEnabledAt: new Date() } })).id;
    makerspaceId = (await prisma.makerspace.create({ data: { name: "Queue Lab", slug: `queue-lab-${suffix}`, status: "ACTIVE", teamMembers: { create: { userId: ownerId, role: "BOOKINGS_MANAGER" } } } })).id;
  });
  afterAll(async () => {
    const queues = getQueues();
    for (const queue of Object.values(queues)) await queue.obliterate({ force: true });
    await closeQueues(queues);
    await prisma.auditEvent.deleteMany({ where: { actorUserId: { in: [adminId, ownerId] } } });
    await prisma.makerspace.delete({ where: { id: makerspaceId } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, ownerId] } } });
    vi.unstubAllEnvs();
  });

  it("sends anonymous people to sign in", async () => {
    context.userId = "";
    await expect(loadSuperAdminJobsView()).rejects.toThrow("REDIRECT:/login");
    await expect(manageJobsAction({ queue: "outbox", operation: "pause" })).rejects.toThrow("REDIRECT:/login");
  });

  it("hides instance jobs from a makerspace owner", async () => {
    context.userId = ownerId;
    await expect(loadSuperAdminJobsView()).rejects.toThrow("NOT_FOUND");
    await expect(manageJobsAction({ queue: "outbox", operation: "pause" })).rejects.toThrow("NOT_FOUND");
  });

  it("validates, pauses and resumes with an audit row", async () => {
    context.userId = adminId;
    expect((await manageJobsAction({ queue: "untrusted", operation: "pause" })).ok).toBe(false);
    expect((await manageJobsAction({ queue: "outbox", operation: "retry" })).ok).toBe(false);
    expect((await manageJobsAction({ queue: "outbox", operation: "pause" })).ok).toBe(true);
    expect(await getQueues().outbox.isPaused()).toBe(true);
    expect((await manageJobsAction({ queue: "outbox", operation: "resume" })).ok).toBe(true);
    expect(await getQueues().outbox.isPaused()).toBe(false);
    expect(await prisma.auditEvent.count({ where: { actorUserId: adminId, action: { startsWith: "JOBS_" } } })).toBe(2);
    const view = await loadSuperAdminJobsView();
    expect(view.health?.map((queue) => queue.name)).toEqual(["outbox", "scheduled"]);
  });
});
