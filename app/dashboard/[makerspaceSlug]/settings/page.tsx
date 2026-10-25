import { loadMakerspaceSettingsView } from "@/lib/views/app__dashboard__makerspaceSlug__settings__page";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { EditMakerspaceForm } from "@/components/makerspace/EditMakerspaceForm";
import { CopyMakerspaceUrl } from "@/components/makerspace/CopyMakerspaceUrl";
import { DeleteMakerspaceButton } from "@/components/dashboard/DeleteMakerspaceButton";
import { MakerspacePageHeader } from "@/components/dashboard/makerspace/MakerspacePageHeader";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { cn } from "@/lib/cn";

import type { Metadata } from "next";

type Props = { params: Promise<{ makerspaceSlug: string; }>; };

export const metadata: Metadata = {
  title: "Settings",
  description: "Edit makerspace details.",
};

const sectionCard = "rounded-xl border border-line bg-panel p-5 sm:p-6";

export default async function MakerspaceSettingsPage({ params }: Props) {
  const { makerspace, canDelete } = await loadMakerspaceSettingsView({ params });
  return (
    <div className="flex flex-col gap-7">
      <MakerspacePageHeader
        makerspace={{ name: makerspace.name, slug: makerspace.slug, logoUrl: makerspace.logoUrl }}
        title="Settings"
        description={`How ${makerspace.name} appears on its public page.`}
      />
      <SettingsTabs slug={makerspace.slug} />

      <div className="flex min-w-0 flex-col gap-6">
        <EditMakerspaceForm
          id="profile"
          makerspaceSlug={makerspace.slug}
          initial={{
            name: makerspace.name,
            description: makerspace.description ?? "",
            logoUrl: makerspace.logoUrl,
          }}
        />

        <section id="public-page" aria-labelledby="public-page-title" className={cn(sectionCard, "flex flex-col gap-4 md:flex-row md:items-center")}>
          <div className="min-w-0 flex-1">
            <h2 id="public-page-title" className="text-h4 text-ink">Public page</h2>
            <p className="mt-0.5 text-body-ui text-ink-muted">One link where people find you and book your spaces. The address can&apos;t be changed.</p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="max-w-full truncate rounded-full bg-muted px-3.5 py-2 tabular-nums text-sm text-ink-secondary">/m/{makerspace.slug}</span>
            <CopyMakerspaceUrl slug={makerspace.slug} />
            <Link
              href={`/m/${makerspace.slug}`}
              className="inline-flex min-h-11 items-center gap-1 px-2 text-sm font-semibold text-ink-secondary underline-offset-4 hover:text-ink hover:underline"
            >
              Open
              <ExternalLink aria-hidden className="size-3.5" />
            </Link>
          </div>
        </section>

        {canDelete ? (
          <section
            id="danger-zone"
            aria-labelledby="danger-zone-title"
            className={cn(sectionCard, "flex flex-col gap-4 border-[1.5px] border-danger-border md:flex-row md:items-center")}
          >
            <div className="min-w-0 flex-1">
              <h2 id="danger-zone-title" className="text-h4 text-danger-fg">Delete makerspace</h2>
              <p className="mt-0.5 text-body-ui text-ink-secondary">
                Permanently removes {makerspace.name} with all of its settings and team. You&apos;ll be asked to type the name to confirm.
              </p>
            </div>
            <div className="shrink-0">
              <DeleteMakerspaceButton makerspaceSlug={makerspace.slug} makerspaceName={makerspace.name} />
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
