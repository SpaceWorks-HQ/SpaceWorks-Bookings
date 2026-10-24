import Link from "next/link";
import type { Metadata } from "next";
import { Search } from "lucide-react";
import { loadMakerspacesDirectory } from "@/lib/views/app__makerspaces__page";
import { indianStateName } from "@/lib/indianStates";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, MakerspaceLogo } from "@/components/ui/display";

export const metadata: Metadata = { title: "Makerspaces", description: "Find a makerspace and book its spaces." };

export default async function MakerspacesDirectoryPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { q, page, pages, total, makerspaces } = await loadMakerspacesDirectory({ searchParams });
  const link = (target: number) => `/makerspaces?${new URLSearchParams({ ...(q ? { q } : {}), page: String(target) })}`;
  return (
    <div className="flex flex-col gap-8">
      <header className="flex max-w-[680px] flex-col gap-3">
        <h1 className="text-display-m text-ink">Find your makerspace.</h1>
        <p className="text-body-l text-ink-secondary">Makerspaces taking bookings on this platform. Open one to see its spaces.</p>
      </header>
      <form role="search" className="flex max-w-[560px] gap-2" action="/makerspaces">
        <label htmlFor="makerspace-search" className="sr-only">Search makerspaces</label>
        <div className="relative flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
          <input id="makerspace-search" name="q" defaultValue={q} placeholder="Name, kind or city" className="min-h-11 w-full rounded-control border border-line-strong bg-panel pl-10 pr-4 text-base text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--sw-ui-focus))]" />
        </div>
        <button type="submit" className={buttonClasses({ variant: "primary" })}>Search</button>
      </form>

      {makerspaces.length === 0 ? (
        <EmptyState {...(q ? { mood: "sleepy" as const } : { patch: true })} title={q ? "Nothing matches" : "No public makerspaces yet"}>
          {q ? "Try a shorter search." : "Makerspaces appear here once the platform lists them."}
        </EmptyState>
      ) : (
        <>
          <p className="text-caption text-ink-muted">{total} {total === 1 ? "makerspace" : "makerspaces"}</p>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {makerspaces.map((makerspace) => (
              <li key={makerspace.slug}>
                <Link href={`/m/${makerspace.slug}`} className="flex h-full flex-col gap-3 rounded-2xl border border-line bg-panel p-5 transition-colors hover:border-line-strong hover:bg-subtle">
                  <div className="flex items-center gap-3">
                    <MakerspaceLogo name={makerspace.name} src={makerspace.logoUrl} size="md" />
                    <div className="min-w-0">
                      <h2 className="truncate text-h4 text-ink">{makerspace.name}</h2>
                      <p className="truncate text-caption text-ink-muted">{[makerspace.kind, makerspace.city, indianStateName(makerspace.stateCode)].filter(Boolean).join(" · ")}</p>
                    </div>
                  </div>
                  {makerspace.description ? <p className="line-clamp-3 text-body-ui text-ink-secondary">{makerspace.description}</p> : null}
                  <p className="mt-auto text-caption font-semibold text-ink">See spaces</p>
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
