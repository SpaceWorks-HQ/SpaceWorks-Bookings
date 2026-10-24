export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateRuntimeEnvironment } = await import("@/lib/env");
    validateRuntimeEnvironment();
    // Background jobs run in the BullMQ worker and beat processes; this is only Redis-free development.
    if (process.env.NODE_ENV !== "production" && !process.env.REDIS_URL && process.env.JOBS_INPROCESS === "true") {
      const { startInProcessJobs } = await import("@/lib/outboxWorker");
      startInProcessJobs();
    }
  }
}
