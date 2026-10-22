import Link from "next/link";
import type { ReactNode } from "react";
import { MakerspaceLogo } from "@/components/ui/display";

/**
 * Compact header for a makerspace's sub-pages (Members, Settings):
 * logo, "Makerspace / Page" breadcrumb, title, one-line description and actions.
 */
export function MakerspacePageHeader({
  makerspace,
  title,
  description,
  actions,
}: {
  makerspace: { name: string; slug: string; logoUrl: string | null };
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <MakerspaceLogo name={makerspace.name} src={makerspace.logoUrl} size="lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm text-ink-muted">
          <Link href={`/dashboard/${makerspace.slug}`} className="underline-offset-4 hover:text-ink hover:underline">
            {makerspace.name}
          </Link>
          <span aria-hidden> / </span>
          <span>{title}</span>
        </p>
        <h1 className="text-h1 text-ink">{title}</h1>
        {description ? <p className="text-body-ui text-ink-secondary">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
    </header>
  );
}
