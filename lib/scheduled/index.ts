import "server-only";
import type { JobDefinition } from "@/lib/queue/definitions";
import { enqueueDueOutbox } from "@/lib/queue/enqueue";
import { deliverOutboxBatch } from "@/lib/outbox";
import { OUTBOX_HEARTBEAT_KEY, recordHeartbeatAlive } from "@/lib/operationalHeartbeat";
import { reconcileGatewayPayments } from "@/lib/payments/reconcile";
import { reconcileGatewayRefunds } from "@/lib/payments/reconcileRefunds";
import { purgeExpiredOperationalData } from "@/lib/retention";

/**
 * Every periodic job, one entry per area. Beat (scripts/queue/beat.ts) turns each into a BullMQ job scheduler
 * `registry-<area>`; the worker runs `run(now)`. The default is the `scheduled` queue every minute. To add a job,
 * write `lib/scheduled/<area>.ts` exporting `run(now)` and add `{ area, run }` here (optionally `queue` and
 * `schedule: { every: ms }` or `{ pattern: "cron", tz }`). Removing an entry removes its scheduler on the next deploy.
 */
export const SCHEDULED_JOBS: JobDefinition[] = [
  // SQL is the durable outbox; this relays due rows to the outbox queue by id.
  { area: "outbox-relay", queue: "outbox", schedule: { every: 5_000 }, run: async () => { await enqueueDueOutbox(); } },
  // Missed webhooks: poll open gateway attempts and pending gateway refunds.
  { area: "payments-reconcile", schedule: { every: 5 * 60_000 }, run: async (now) => { await reconcileGatewayPayments(now); } },
  { area: "refunds-reconcile", schedule: { every: 5 * 60_000 }, run: async (now) => { await reconcileGatewayRefunds(now); } },
  { area: "operational-retention", schedule: { pattern: "0 0 * * *", tz: "UTC" }, run: async (now) => { await purgeExpiredOperationalData(now); } },
  // Proves worker and beat are alive for Super admin, Operations.
  { area: "heartbeat", run: async () => { await recordHeartbeatAlive(OUTBOX_HEARTBEAT_KEY); } },
];

/** The Redis-free fallback (development with JOBS_INPROCESS): every job inline, delivering the outbox directly. */
export async function runScheduledJobs(now = new Date()) {
  const failed: string[] = [];
  for (const job of SCHEDULED_JOBS) {
    try {
      if (job.area === "outbox-relay" && !process.env.REDIS_URL) await deliverOutboxBatch();
      else await job.run(now);
    } catch {
      failed.push(job.area);
      console.error(`[scheduler] ${job.area} job failed`);
    }
  }
  return { ran: SCHEDULED_JOBS.length, failed };
}
