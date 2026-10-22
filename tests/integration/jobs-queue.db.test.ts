import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const sendRenderedEmail = vi.hoisted(() => vi.fn(async (): Promise<"sent" | "dropped"> => "sent"));
// A real outbox kind whose delivery is replaced, so no SMTP is involved.
vi.mock("@/lib/email/makerspace", () => {
  const same = (value: unknown) => value;
  return { asNoticePayload: same, asAdminPayload: same, asInvitePayload: same, deliverMakerspaceNotice: sendRenderedEmail, deliverAdminApplicationAlert: sendRenderedEmail, deliverOwnerInvite: sendRenderedEmail };
});
import { prisma } from "@/lib/db";
import { createQueues, closeQueues, queueConnection } from "@/lib/queue/client";
import { createWorkers, processQueueJob } from "@/lib/queue/worker";
import { syncSchedules } from "@/lib/queue/beat";
import { jobId, QUEUE_NAMES, type JobDefinition } from "@/lib/queue/definitions";

// Unique key prefix in shared DB 0. Never flush Redis or touch other features' keys.
const prefix = `swb:test:jobs:${randomUUID()}`;
const redisUrl = process.env.TEST_QUEUE_REDIS_URL || "redis://127.0.0.1:6379/0";
const queues = createQueues(prefix, queueConnection(false, redisUrl));
const rows: string[] = [];
const pools: ReturnType<typeof createWorkers>[] = [];
async function until(check: () => Promise<boolean>) {
  await vi.waitFor(async () => expect(await check()).toBe(true), { timeout: 10_000, interval: 30 });
}
async function message() {
  const row = await prisma.outboxMessage.create({ data: { kind: "makerspace-notice", payload: { to: "jobs-fixture@example.test", makerspaceId: "fixture", notice: "approved" } } });
  rows.push(row.id); return row;
}
async function pool() {
  const workers = createWorkers({ prefix, redisUrl }); pools.push(workers); await workers.ready(); return workers;
}
describe.sequential("BullMQ workers and beat against Redis and Postgres", () => {
  beforeAll(async () => { await Promise.all(QUEUE_NAMES.map(name => queues[name].waitUntilReady())); });
  afterEach(async () => {
    await Promise.all(pools.splice(0).map(workers => workers.close()));
    for (const name of QUEUE_NAMES) await queues[name].obliterate({ force: true });
    await prisma.outboxMessage.deleteMany({ where: { id: { in: rows.splice(0) } } });
    sendRenderedEmail.mockReset();
    sendRenderedEmail.mockResolvedValue("sent");
  });
  afterAll(async () => { await closeQueues(queues); await prisma.$disconnect(); });
  it("delivers one outbox row once with duplicate enqueues and two worker instances", async () => {
    const row = await message();
    await Promise.all([pool(), pool()]);
    await Promise.all([1, 2, 3].map(() => queues.outbox.add("deliver", { kind: "outbox", outboxId: row.id }, { jobId: jobId("outbox", row.id) })));
    await until(async () => (await prisma.outboxMessage.findUniqueOrThrow({ where: { id: row.id } })).status === "SENT");
    expect(sendRenderedEmail).toHaveBeenCalledTimes(1);
    expect((await prisma.outboxMessage.findUniqueOrThrow({ where: { id: row.id } })).attempts).toBe(1);
    const jobs = await queues.outbox.getJobs(["completed", "active", "waiting"]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data).toEqual({ kind: "outbox", outboxId: row.id });
  });
  it("beat upserts without duplicates, changes cadence and removes stale schedules", async () => {
    const run = async () => undefined;
    const registry: JobDefinition[] = [{ area: "fixture", run, schedule: { every: 60_000 } }, { area: "removed", run, queue: "outbox" }];
    await Promise.all([syncSchedules(queues, registry), syncSchedules(queues, registry)]);
    expect(await queues.scheduled.getJobSchedulersCount()).toBe(1);
    expect(await queues.outbox.getJobSchedulersCount()).toBe(1);
    await syncSchedules(queues, [{ area: "fixture", run, schedule: { every: 120_000 } }]);
    expect(await queues.outbox.getJobSchedulersCount()).toBe(0);
    const [schedule] = await queues.scheduled.getJobSchedulers();
    expect(Number(schedule.every)).toBe(120_000);
    await syncSchedules(queues, []);
    expect(await queues.scheduled.getJobSchedulersCount()).toBe(0);
    expect(await queues.scheduled.getDelayedCount()).toBe(0);
  });
  it("keeps a transient SQL delivery pending and resumes its delayed job", async () => {
    sendRenderedEmail.mockRejectedValueOnce(new Error("private provider response"));
    const row = await message();
    await pool();
    const job = await queues.outbox.add("deliver", { kind: "outbox", outboxId: row.id });
    await until(async () => await job.getState() === "delayed");
    const pending = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: row.id } });
    expect(pending.status).toBe("PENDING");
    expect(pending.attempts).toBe(1);
    expect(pending.lastError).not.toContain("provider response");
    await prisma.outboxMessage.update({ where: { id: row.id }, data: { availableAt: new Date() } });
    await job.promote();
    await until(async () => await job.getState() === "completed");
    expect(sendRenderedEmail).toHaveBeenCalledTimes(2);
    expect((await prisma.outboxMessage.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("SENT");
  });
  it("retains failures safely and retries a failed job", async () => {
    const row = await message();
    await prisma.outboxMessage.update({ where: { id: row.id }, data: { status: "FAILED" } });
    await pool();
    const job = await queues.outbox.add("deliver", { kind: "outbox", outboxId: row.id });
    await until(async () => await job.getState() === "failed");
    expect((await queues.outbox.getJob(job.id!))?.failedReason).not.toContain("example.test");
    await prisma.outboxMessage.update({ where: { id: row.id }, data: { status: "PENDING" } });
    await job.retry();
    await until(async () => await job.getState() === "completed");
    expect(sendRenderedEmail).toHaveBeenCalledTimes(1);
  });
  it("graceful close waits for delivery and its final SQL update", async () => {
    let release!: () => void;
    sendRenderedEmail.mockImplementationOnce(() => new Promise<"sent">(resolve => { release = () => resolve("sent"); }));
    const row = await message();
    const workers = await pool();
    const job = await queues.outbox.add("deliver", { kind: "outbox", outboxId: row.id });
    await until(async () => (await prisma.outboxMessage.findUniqueOrThrow({ where: { id: row.id } })).status === "PROCESSING");
    let closed = false;
    const closing = workers.close().then(() => { closed = true; });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(closed).toBe(false);
    release(); await closing;
    expect((await prisma.outboxMessage.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("SENT");
    expect(await job.getState()).toBe("completed");
  });
  it("reclaims a stale SQL claim after an abrupt worker exit", async () => {
    const row = await message();
    await prisma.outboxMessage.update({ where: { id: row.id }, data: { status: "PROCESSING", lockedAt: new Date(Date.now() - 16 * 60_000) } });
    await pool();
    const job = await queues.outbox.add("deliver", { kind: "outbox", outboxId: row.id });
    await until(async () => await job.getState() === "completed");
    expect(sendRenderedEmail).toHaveBeenCalledTimes(1);
  });
  it("rejects unregistered work", async () => {
    await expect(processQueueJob({ data: { kind: "registered", area: "unknown-fixture" } } as Parameters<typeof processQueueJob>[0])).rejects.toThrow("registration removed");
  });
});
