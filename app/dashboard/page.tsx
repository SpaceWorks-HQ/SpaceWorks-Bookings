import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import type { Metadata } from "next";
import { loadDashboardView } from "@/lib/views/app__dashboard__page";
import { MakerspaceStatusChip } from "@/components/makerspace/MakerspaceStatusChip";
import { ROLE_LABELS } from "@/lib/permissionRoles";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, MakerspaceLogo, PageHeader } from "@/components/ui/display";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { firstName, teams } = await loadDashboardView();
  const apply = (
    <Link href="/start" className={buttonClasses({ variant: "primary" })}>
      <Plus aria-hidden className="size-4" />
      Apply for a makerspace
    </Link>
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker="Home"
        title={`Hello, ${firstName}`}
        description={teams.length ? "Pick a makerspace to manage its spaces, bookings and payments." : undefined}
        actions={teams.length ? <Link href="/start" className={buttonClasses({ variant: "secondary" })}>Apply for another</Link> : undefined}
      />

      {teams.length === 0 ? (
        <EmptyState patch title="No makerspaces yet" action={apply}>
          Apply to take bookings for your makerspace&rsquo;s spaces here. A platform admin reviews every application, or ask an
          makerspace&rsquo;s bookings manager to invite you to their team.
        </EmptyState>
      ) : (
        <section aria-label="Your makerspaces" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {teams.map((team) => (
            <Link
              key={team.slug}
              href={`/dashboard/${team.slug}`}
              className="group flex flex-col gap-4 rounded-xl border border-line bg-panel p-5 transition-colors hover:border-line-strong"
            >
              <span className="flex items-center gap-3">
                <MakerspaceLogo name={team.name} src={team.logoUrl} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-title text-ink">{team.name}</span>
                  <span className="block truncate text-caption text-ink-muted">{[ROLE_LABELS[team.role], team.kind].filter(Boolean).join(" · ")}</span>
                </span>
                <ArrowRight aria-hidden className="size-5 shrink-0 text-ink-muted transition-colors group-hover:text-ink" />
              </span>
              {team.status === "ACTIVE" ? null : <MakerspaceStatusChip status={team.status} />}
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
