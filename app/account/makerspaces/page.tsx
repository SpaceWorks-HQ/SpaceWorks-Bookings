import { loadAccountMakerspacesView } from "@/lib/views/app__account__makerspaces__page";
import type { Metadata } from "next";
import { AccountMakerspaces } from "@/components/account/makerspaces/AccountMakerspaces";

export const metadata: Metadata = { title: "Your makerspaces" };

export default async function AccountMakerspacesPage() {
  const { data } = await loadAccountMakerspacesView();
  return <AccountMakerspaces data={data} />;
}
