import { requireAuth } from "@/lib/permissions";
import { loadAccountOrganisations } from "@/components/account/organisations/data";

export async function loadAccountOrganisationsView() {
  const session = await requireAuth();
  const data = await loadAccountOrganisations(session.user.id);
  return { data };
}
