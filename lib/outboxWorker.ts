import "server-only";

import { OUTBOX_HEARTBEAT_KEY, recordHeartbeatFailure, recordHeartbeatStarted, recordHeartbeatSuccess } from "@/lib/operationalHeartbeat";
import { runScheduledJobs } from "@/lib/scheduled";

const INTERVAL_MS = 60_000;
const WORKER_KEY = Symbol.for("swb.inProcessJobs");

type WorkerState = { started: boolean; running: boolean; timer?: ReturnType<typeof setInterval> };

/** One pass of every registered job inline (outbox delivered directly), with its heartbeat. */
export async function runInProcessJobs() {
  await recordHeartbeatStarted(OUTBOX_HEARTBEAT_KEY).catch(() => undefined);
  try {
    const result = await runScheduledJobs();
    await recordHeartbeatSuccess(OUTBOX_HEARTBEAT_KEY).catch(() => undefined);
    return result;
  } catch (error) {
    await recordHeartbeatFailure(OUTBOX_HEARTBEAT_KEY, error).catch(() => undefined);
    throw error;
  }
}

/**
 * Development without Redis only (`JOBS_INPROCESS=true`): poll every minute in the web process. Production
 * always runs the BullMQ `worker` and `beat` processes. The globalThis guard avoids duplicate timers during HMR.
 */
export function startInProcessJobs() {
  if (process.env.NODE_ENV === "production" || process.env.REDIS_URL || process.env.JOBS_INPROCESS !== "true") return;
  const g = globalThis as typeof globalThis & { [WORKER_KEY]?: WorkerState };
  if (g[WORKER_KEY]?.started) return;
  const state: WorkerState = { started: true, running: false };
  g[WORKER_KEY] = state;
  const tick = async () => {
    if (state.running) return;
    state.running = true;
    try {
      await runInProcessJobs();
    } catch {
      console.error("[jobs] in-process run failed");
    } finally {
      state.running = false;
    }
  };
  void tick();
  state.timer = setInterval(() => void tick(), INTERVAL_MS);
  state.timer.unref?.();
}
