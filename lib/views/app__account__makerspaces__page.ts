import { requireAuth } from "@/lib/permissions";
import { loadAccountMakerspaces } from "@/components/account/makerspaces/data";

export async function loadAccountMakerspacesView() {
  const session = await requireAuth();
  const data = await loadAccountMakerspaces(session.user.id);
  return { data };
}
