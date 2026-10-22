// The scheduler container: asks the app to run one scheduler pass (outbox
// delivery, the membership sweep, retention and every job added to
// runOutboxScheduler in lib/outboxWorker.ts) each minute, one pass at a time.
// The app runs no in-process worker (SCHEDULER_MODE=external).
//   node docker/ops/scheduler.mjs               run the loop
//   node docker/ops/scheduler.mjs --healthcheck exit 0 if a pass succeeded recently
// Never logs credentials, URLs or response bodies.
import { readFileSync, writeFileSync } from "node:fs";

const heartbeat = "/tmp/scheduler-heartbeat";
const intervalMs = 60_000;

if (process.argv[2] === "--healthcheck") {
  try {
    const last = Date.parse(readFileSync(heartbeat, "utf8"));
    process.exit(Date.now() - last < 5 * intervalMs ? 0 : 1);
  } catch {
    process.exit(1);
  }
}

const target = process.env.SWO_SCHEDULER_TARGET || "http://backend:3000/api/internal/outbox";
if (!process.env.CRON_SECRET) {
  console.error("[scheduler] CRON_SECRET is required.");
  process.exit(1);
}

async function pass() {
  try {
    const response = await fetch(target, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      signal: AbortSignal.timeout(240_000),
    });
    await response.body?.cancel();
    if (!response.ok) return console.error(`[scheduler] pass returned HTTP ${response.status}.`);
    writeFileSync(heartbeat, new Date().toISOString());
  } catch {
    console.error("[scheduler] pass request failed.");
  }
}

for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => process.exit(0));
console.log("[scheduler] started; one pass every 60 seconds.");
for (;;) {
  const started = Date.now();
  await pass();
  await new Promise((resolve) => setTimeout(resolve, Math.max(1_000, intervalMs - (Date.now() - started))));
}
