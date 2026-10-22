import { loadAccountOrganisationsView } from "@/lib/views/app__account__organisations__page";
import type { Metadata } from "next";
import { AccountOrganisations } from "@/components/account/organisations/AccountOrganisations";

export const metadata: Metadata = { title: "Your organisations" };

export default async function AccountOrganisationsPage() {
  const { data } = await loadAccountOrganisationsView();
  return <AccountOrganisations data={data} />;
}
