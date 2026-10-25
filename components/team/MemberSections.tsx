import type { ReactNode } from "react";
import type { TeamRole } from "@prisma/client";
import { cn } from "@/lib/cn";
import { Chip } from "@/components/ui/display";
import { ROLE_LABELS } from "@/components/team/memberSummary";
import { ROLE_DESCRIPTIONS } from "@/lib/permissionRoles";

const DOT_TONES: Record<TeamRole, string> = { BOOKINGS_MANAGER: "bg-primary", FRONT_DESK: "bg-ink-muted", VIEWER: "bg-line-strong", TECHNICIAN: "bg-info-solid" };

/* ---------- Stats ---------- */

export function MemberStat({ label, value, hint, dots }: { label: string; value: ReactNode; hint: ReactNode; dots?: TeamRole[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5 rounded-lg border border-line bg-panel px-5 py-4">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="flex min-w-0 items-end justify-between gap-3">
        <span className="font-display text-[34px] font-semibold leading-none text-ink">{value}</span>
        {dots && dots.length > 0 ? (
          <span aria-hidden className="flex min-w-0 flex-wrap justify-end gap-1 pb-1">
            {dots.map((role, index) => (
              <span key={index} className={cn("size-[9px] rounded-full", DOT_TONES[role])} />
            ))}
          </span>
        ) : null}
      </span>
      <span className="truncate text-caption text-ink-muted">{hint}</span>
    </div>
  );
}

/* ---------- Roles ---------- */

const ROLE_SUMMARIES: Array<{ role: TeamRole; tone: "ink" | "warning" | "success" | "info" | "neutral"; body: string }> = [
  { role: "BOOKINGS_MANAGER", tone: "ink", body: ROLE_DESCRIPTIONS.BOOKINGS_MANAGER },
  { role: "FRONT_DESK", tone: "neutral", body: ROLE_DESCRIPTIONS.FRONT_DESK },
  { role: "VIEWER", tone: "neutral", body: ROLE_DESCRIPTIONS.VIEWER },
  { role: "TECHNICIAN", tone: "info", body: ROLE_DESCRIPTIONS.TECHNICIAN },
];

export function RolesCard() {
  return (
    <section aria-labelledby="roles-title" className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-panel p-5">
      <h2 id="roles-title" className="text-h4 text-ink">What each role can do</h2>
      <dl className="flex flex-col gap-3">
        {ROLE_SUMMARIES.map(({ role, tone, body }) => (
          <div key={role} className="flex gap-3">
            <dt className="shrink-0">
              <Chip size="sm" tone={tone} className="min-w-[64px] justify-center">{ROLE_LABELS[role]}</Chip>
            </dt>
            <dd className="min-w-0 text-body-ui text-ink-secondary">{body}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
