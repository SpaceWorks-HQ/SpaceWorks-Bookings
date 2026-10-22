export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateRuntimeEnvironment } = await import("@/lib/env");
    validateRuntimeEnvironment();
    // Compose deployments run a separate scheduler container (SCHEDULER_MODE=external).
    if (process.env.SCHEDULER_MODE !== "external") {
      const { startOutboxWorker } = await import("@/lib/outboxWorker");
      startOutboxWorker();
    }
  }
}
