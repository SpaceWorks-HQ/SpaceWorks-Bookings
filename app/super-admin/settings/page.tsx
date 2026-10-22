import { requireSuperAdmin } from "@/lib/permissions";
import { loadSuperAdminSettingsView } from "@/lib/views/app__super-admin__settings__page";
import { InstanceServiceSettingsForm } from "@/components/super-admin/InstanceServiceSettingsForm";
import { SignInProvidersForm } from "@/components/super-admin/SignInProvidersForm";
import { PageHeader, SectionHeading } from "@/components/ui/display";

export default async function SuperAdminSettingsPage() {
  await requireSuperAdmin();
  const { initial, providers } = await loadSuperAdminSettingsView();
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Instance settings" description="Email delivery, sign-in providers and backup status for this instance. Secrets are encrypted and never displayed." />
      <section className="flex flex-col gap-4">
        <SectionHeading title="Sign-in providers" description="Offer Google, Apple or GitHub sign-in beside email and password. Accounts link by verified email." />
        <SignInProvidersForm initial={providers} />
      </section>
      <section className="flex flex-col gap-4">
        <SectionHeading title="Email and backups" />
        <InstanceServiceSettingsForm initial={initial} />
      </section>
    </div>
  );
}
