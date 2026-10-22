import "server-only";

import { deliverOutboxBatch } from "@/lib/outbox";
import {
  recordOutboxSchedulerFailure,
  recordOutboxSchedulerStarted,
  recordOutboxSchedulerSuccess,
} from "@/lib/operationalHeartbeat";
import { purgeExpiredOperationalData } from "@/lib/retention";
import { runMembershipSweep } from "@/lib/membership/sweep";
import { reconcileGatewayPayments } from "@/lib/payments/reconcile";
import { reconcileGatewayRefunds } from "@/lib/payments/reconcileRefunds";
import { queueMonthlyDigests } from "@/lib/reports/digest";
import { kickCardExportJobs, runCardExportJobs } from "@/lib/cards/exportJobs";

const OUTBOX_WORKER_INTERVAL_MS = 60_000;

type OutboxWorkerState = {
  started?: boolean;
  running?: boolean;
  timer?: ReturnType<typeof setInterval>;
};

function workerState() {
  return globalThis as typeof globalThis & { __sweOutboxWorker?: OutboxWorkerState };
}

/**
 * Runs one complete delivery/retention pass and records its operational state. `awaitExports` is for the
 * cron endpoint: on a serverless host the process may stop once the request returns, so the card export
 * pass is waited for instead of left running in the background.
 */
export async function runOutboxScheduler(options: { awaitExports?: boolean } = {}) {
  // Heartbeat persistence is observability, not part of the delivery commit.
  // A heartbeat-table issue must not stop otherwise healthy queue processing.
  await recordOutboxSchedulerStarted().catch(() => undefined);
  try {
    // Membership changes first, so reminders and notices they queue go out in the same pass.
    await runMembershipSweep().catch(() => console.error("[membership sweep] run failed"));
    await reconcileGatewayPayments().catch(() => console.error("[payments reconcile] run failed"));
    await reconcileGatewayRefunds().catch(() => console.error("[refunds reconcile] run failed"));
    await queueMonthlyDigests().catch(() => console.error("[report digest] run failed"));
    const result = await deliverOutboxBatch();
    // Bulk card exports (background PDF/ZIP builds) run on their own, so a long render never holds this pass up.
    if (options.awaitExports) await runCardExportJobs().catch(() => console.error("[card exports] run failed"));
    else kickCardExportJobs();
    const purged = await purgeExpiredOperationalData();
    await recordOutboxSchedulerSuccess(result).catch(() => undefined);
    return { ...result, purged };
  } catch (error) {
    await recordOutboxSchedulerFailure(error).catch(() => undefined);
    throw error;
  }
}

/**
 * Start one polling worker per Node.js process. Queue row claims make this safe
 * across replicas; the singleton guard avoids duplicate timers during dev HMR.
 */
export function startOutboxWorker() {
  const runtime = workerState();
  if (runtime.__sweOutboxWorker?.started) return;

  const state: OutboxWorkerState = { started: true, running: false };
  runtime.__sweOutboxWorker = state;

  const tick = async () => {
    if (state.running) return;
    state.running = true;
    try {
      await runOutboxScheduler();
    } catch {
      // Failure metadata is persisted separately without exception text.
      console.error("[outbox worker] scheduler run failed");
    } finally {
      state.running = false;
    }
  };

  void tick();
  state.timer = setInterval(() => {
    void tick();
  }, OUTBOX_WORKER_INTERVAL_MS);
  state.timer.unref?.();
}
