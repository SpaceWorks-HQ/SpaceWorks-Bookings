import Link from "next/link";
import { requireSuperAdmin } from "@/lib/permissions";
import { ArrowLeft } from "lucide-react";
import { loadSuperAdminNewMakerspaceView } from "@/lib/views/app__super-admin__makerspaces__new__page";
import { CreateMakerspaceForm } from "@/components/super-admin/CreateMakerspaceForm";
import { PageHeader } from "@/components/ui/display";

export default async function SuperAdminNewMakerspacePage() {
  await requireSuperAdmin();
  await loadSuperAdminNewMakerspaceView();
  return (
    <div className="flex max-w-[760px] flex-col gap-6">
      <Link href="/super-admin/makerspaces" className="inline-flex w-fit items-center gap-1 text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline">
        <ArrowLeft aria-hidden className="size-4" />
        Makerspaces
      </Link>
      <PageHeader title="Add a makerspace" description="Skip the application: set it up as active and invite its first bookings manager." />
      <CreateMakerspaceForm />
    </div>
  );
}
