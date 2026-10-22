"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { revertToOrganisationCardDesign } from "@/app/actions/card-design";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { cn } from "@/lib/cn";

/**
 * Which design the designer edits: the organisation's (every plan's cards use it) or one plan's own.
 * A plan without its own design starts from the organisation's; saving gives it its own.
 */
export function DesignScopePicker({ slug, plans, planId, source, disabled }: { slug: string; plans: Array<{ id: string; name: string; ownDesign: boolean }>; planId: string | null; source: "plan" | "organisation" | "default"; disabled: boolean }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const base = `/dashboard/${slug}/settings/cards`;
  const items = [{ id: null as string | null, name: "Organisation design", own: true }, ...plans.map((plan) => ({ id: plan.id as string | null, name: plan.name, own: plan.ownDesign }))];
  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Design for" className="flex flex-wrap gap-2">
        {items.map((item) => (
          <Link
            key={item.id ?? "organisation"}
            href={item.id ? `${base}?plan=${item.id}` : base}
            aria-current={item.id === planId ? "page" : undefined}
            className={cn(
              "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-[14px] transition-colors duration-[120ms]",
              item.id === planId ? "border-primary bg-primary font-semibold text-on-primary" : "border-line bg-panel text-ink hover:bg-muted",
            )}
          >
            {item.name}
            {item.id && item.own ? <span className={cn("text-caption", item.id === planId ? "text-on-primary" : "text-ink-muted")}>· own design</span> : null}
          </Link>
        ))}
      </nav>
      {planId && source !== "plan" ? (
        <Callout tone="info">This plan&apos;s cards use the organisation design. Change anything below to give this plan its own.</Callout>
      ) : null}
      {planId && source === "plan" ? (
        <Callout
          tone="info"
          action={disabled ? undefined : (
            <Button size="sm" variant="secondary" loading={busy} onClick={() => startTransition(async () => { await revertToOrganisationCardDesign({ organisationSlug: slug, planId }); router.refresh(); })}>
              Use organisation design
            </Button>
          )}
        >
          This plan has its own card design. Its cards change as soon as you save.
        </Callout>
      ) : null}
    </div>
  );
}
