import Link from "next/link";
import type { Metadata } from "next";
import { Search } from "lucide-react";
import { loadOrganisationsDirectory } from "@/lib/views/app__organisations__page";
import { indianStateName } from "@/lib/indianStates";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, OrgLogo } from "@/components/ui/display";

export const metadata: Metadata = { title: "Organisations", description: "Find an organisation and apply to become a member." };

export default async function OrganisationsDirectoryPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { q, page, pages, total, organisations } = await loadOrganisationsDirectory({ searchParams });
  const link = (target: number) => `/organisations?${new URLSearchParams({ ...(q ? { q } : {}), page: String(target) })}`;
  return (
    <div className="flex flex-col gap-8">
      <header className="flex max-w-[680px] flex-col gap-3">
        <h1 className="text-display-m text-ink">Find your organisation.</h1>
        <p className="text-body-l text-ink-secondary">Clubs, associations and communities taking members on this platform. Open one to see its plans and apply.</p>
      </header>
      <form role="search" className="flex max-w-[560px] gap-2" action="/organisations">
        <label htmlFor="org-search" className="sr-only">Search organisations</label>
        <div className="relative flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
          <input id="org-search" name="q" defaultValue={q} placeholder="Name, kind or city" className="min-h-11 w-full rounded-control border border-line-strong bg-panel pl-10 pr-4 text-base text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--sw-ui-focus))]" />
        </div>
        <button type="submit" className={buttonClasses({ variant: "primary" })}>Search</button>
      </form>

      {organisations.length === 0 ? (
        <EmptyState {...(q ? { mood: "sleepy" as const } : { patch: true })} title={q ? "Nothing matches" : "No public organisations yet"}>
          {q ? "Try a shorter search." : "Organisations appear here once the platform lists them."}
        </EmptyState>
      ) : (
        <>
          <p className="text-caption text-ink-muted">{total} {total === 1 ? "organisation" : "organisations"}</p>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {organisations.map((org) => (
              <li key={org.slug}>
                <Link href={`/o/${org.slug}`} className="flex h-full flex-col gap-3 rounded-2xl border border-line bg-panel p-5 transition-colors hover:border-line-strong hover:bg-subtle">
                  <div className="flex items-center gap-3">
                    <OrgLogo name={org.name} src={org.logoUrl} size="md" />
                    <div className="min-w-0">
                      <h2 className="truncate text-h4 text-ink">{org.name}</h2>
                      <p className="truncate text-caption text-ink-muted">{[org.kind, org.city, indianStateName(org.stateCode)].filter(Boolean).join(" · ")}</p>
                    </div>
                  </div>
                  {org.description ? <p className="line-clamp-3 text-body-ui text-ink-secondary">{org.description}</p> : null}
                  <p className="mt-auto text-caption font-semibold text-ink">{org._count.plans ? `${org._count.plans} ${org._count.plans === 1 ? "plan" : "plans"} open` : "See membership"}</p>
                </Link>
              </li>
            ))}
          </ul>
          {pages > 1 ? (
            <nav aria-label="Pages" className="flex items-center justify-between text-sm">
              <span className="text-ink-muted">Page {page} of {pages}</span>
              <span className="flex gap-2">
                {page > 1 ? <Link href={link(page - 1)} className={buttonClasses({ variant: "secondary", size: "sm" })}>Previous</Link> : null}
                {page < pages ? <Link href={link(page + 1)} className={buttonClasses({ variant: "secondary", size: "sm" })}>Next</Link> : null}
              </span>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
