import "server-only";

import { prisma } from "@/lib/db";
import { describeOperationalError } from "@/lib/redactSensitiveText";

/** The one heartbeat row for background jobs: the worker's outbox deliveries and the scheduled heartbeat job. */
export const OUTBOX_HEARTBEAT_KEY = "outbox-scheduler";

/** Observability only: a heartbeat failure must never stop delivery. */
export async function recordHeartbeatStarted(key: string) {
  await prisma.operationalHeartbeat.upsert({
    where: { key },
    create: { key, lastStartedAt: new Date() },
    update: { lastStartedAt: new Date() },
  });
}

export async function recordHeartbeatSuccess(key: string, result: { sent?: number; failed?: number } = {}) {
  const now = new Date();
  await prisma.operationalHeartbeat.upsert({
    where: { key },
    create: { key, lastStartedAt: now, lastSucceededAt: now, lastSent: result.sent ?? 0, lastFailed: result.failed ?? 0 },
    update: { lastSucceededAt: now, lastSent: result.sent ?? 0, lastFailed: result.failed ?? 0, lastError: null },
  });
}

export async function recordHeartbeatFailure(key: string, error: unknown) {
  const message = describeOperationalError(error);
  await prisma.operationalHeartbeat.upsert({
    where: { key },
    create: { key, lastStartedAt: new Date(), lastError: message },
    update: { lastError: message },
  });
}

/** The scheduled heartbeat: worker and beat are running, whether or not there was mail to send. */
export async function recordHeartbeatAlive(key: string) {
  const now = new Date();
  await prisma.operationalHeartbeat.upsert({
    where: { key },
    create: { key, lastStartedAt: now, lastSucceededAt: now },
    update: { lastStartedAt: now, lastSucceededAt: now },
  });
}
