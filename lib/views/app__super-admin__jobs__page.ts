import { requireSuperAdmin } from "@/lib/permissions";
import { getJobsHealth } from "@/lib/queue/admin";

/** Queue counts and recent failures (a safe projection: no job data or raw errors). Null when Redis is down. */
export async function loadSuperAdminJobsView() {
  await requireSuperAdmin();
  return { health: await getJobsHealth().catch(() => null) };
}
