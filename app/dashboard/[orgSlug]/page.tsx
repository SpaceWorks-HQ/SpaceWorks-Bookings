import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Check } from "lucide-react";
import { loadOrgOverviewView } from "@/lib/views/app__dashboard__orgSlug__page";
import { ROLE_LABELS } from "@/lib/permissionRoles";
import { STATUS_EXPLANATIONS } from "@/lib/organisationLifecycle";
import { OrgPageHeader } from "@/components/dashboard/org/OrgPageHeader";
import { buttonClasses } from "@/components/ui/button";
import { Callout, Card, CardHeader, StatTile } from "@/components/ui/display";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Overview", robots: { index: false, follow: false } };

export default async function OrgOverviewPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { organisation, role, teamCount, openInvites, steps } = await loadOrgOverviewView({ params });
  const remaining = steps.filter((step) => !step.done).length;
  const base = `/dashboard/${organisation.slug}`;
  return (
    <div className="flex flex-col gap-6">
      <OrgPageHeader organisation={organisation} title="Overview" description={`You're ${role === "ADMIN" || role === "OWNER" ? "an" : "a"} ${ROLE_LABELS[role].toLowerCase()} here.`} />

      {organisation.status !== "ACTIVE" ? (
        <Callout
          tone="danger"
          title={STATUS_EXPLANATIONS[organisation.status].title}
          action={<Link href={`/dashboard/${organisation.slug}/application`} className={buttonClasses({ variant: "secondary", size: "sm" })}>Details</Link>}
        >
          {STATUS_EXPLANATIONS[organisation.status].body}
        </Callout>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile className="rounded-xl" label="Team" value={teamCount.toLocaleString("en-IN")} hint={openInvites ? `${openInvites} open invite${openInvites === 1 ? "" : "s"}` : "No open invites"} href={`${base}/team`} />
      </div>

      {steps.length > 0 ? (
        <Card as="section" className="rounded-xl">
          <CardHeader title="Get set up" description={remaining ? `${remaining} of ${steps.length} left` : "All done. Nice work."} />
          <ol className="flex flex-col divide-y divide-line">
            {steps.map((step) => (
              <li key={step.id}>
                <Link href={step.href} className="group flex items-center gap-4 py-3.5">
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full border",
                      step.done ? "border-transparent bg-success-bg text-success-fg" : "border-line-strong text-transparent",
                    )}
                  >
                    <Check className="size-4" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={cn("text-label font-semibold", step.done ? "text-ink-muted line-through" : "text-ink")}>
                      <span className="sr-only">{step.done ? "Done: " : "To do: "}</span>
                      {step.label}
                    </span>
                    <span className="text-caption text-ink-muted">{step.description}</span>
                  </span>
                  <ArrowRight aria-hidden className="size-4 shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}
    </div>
  );
}
