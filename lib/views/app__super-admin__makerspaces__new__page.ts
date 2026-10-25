import { requireSuperAdmin } from "@/lib/permissions";

/** Gate for the direct-create form; it needs no data. */
export async function loadSuperAdminNewMakerspaceView() {
  await requireSuperAdmin();
  return {};
}
