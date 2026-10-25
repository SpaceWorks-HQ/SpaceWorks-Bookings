import Link from "next/link";
import { Plus } from "lucide-react";
import type { TeamRole } from "@prisma/client";
import { AccountCard } from "@/components/account/AccountCard";
import { MakerspaceStatusChip } from "@/components/makerspace/MakerspaceStatusChip";
import { ROLE_LABELS } from "@/lib/permissionRoles";
import { Button } from "@/components/ui/button";
import { Chip, EmptyState, MakerspaceLogo } from "@/components/ui/display";
import { LeaveMakerspaceButton } from "./LeaveMakerspaceButton";
import type { AccountMembershipRow, AccountMakerspacesData } from "./data";

const ROLE_TONES = { BOOKINGS_MANAGER: "ink", FRONT_DESK: "neutral", VIEWER: "neutral", TECHNICIAN: "info" } as const satisfies Record<TeamRole, string>;

const rowClasses = "flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between";

export function AccountMakerspaces({ data }: { data: AccountMakerspacesData }) {
  return <TeamsCard teams={data.teamMembers} />;
}

function TeamsCard({ teams }: { teams: AccountMembershipRow[] }) {
  const apply = (
    <Button asChild size="sm" variant="secondary">
      <Link href="/start">
        <Plus aria-hidden className="size-4" />
        Apply for a makerspace
      </Link>
    </Button>
  );
  return (
    <AccountCard
      id="account-makerspaces"
      title="Your makerspaces"
      description="Makerspaces whose team you are on, and your role in each."
      action={teams.length ? apply : undefined}
    >
      {teams.length === 0 ? (
        <EmptyState title="You're not on any makerspace's team yet" action={apply}>
          Apply to take bookings for your makerspace&rsquo;s spaces here, or ask a makerspace&rsquo;s bookings manager for an invite link.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {teams.map((team) => (
            <li key={team.id} className={rowClasses}>
              <div className="flex min-w-0 items-center gap-3">
                <MakerspaceLogo name={team.makerspace.name} src={team.makerspace.logoUrl} />
                <div className="min-w-0">
                  <p className="truncate text-label text-ink">{team.makerspace.name}</p>
                  <p className="truncate text-caption text-ink-muted">Joined {team.joinedLabel}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Chip size="sm" tone={ROLE_TONES[team.role]}>{ROLE_LABELS[team.role]}</Chip>
                    {team.makerspace.status === "ACTIVE" ? null : <MakerspaceStatusChip status={team.makerspace.status} />}
                  </div>
                  {team.lastManager ? (
                    <p className="mt-1.5 text-caption text-ink-muted">You&rsquo;re the only bookings manager, so you can&rsquo;t leave yet.</p>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 pl-[52px] sm:pl-0">
                <Button asChild size="sm" variant="secondary">
                  <Link href={`/dashboard/${team.makerspace.slug}`}>
                    Open dashboard
                    <span className="sr-only"> for {team.makerspace.name}</span>
                  </Link>
                </Button>
                <LeaveMakerspaceButton
                  makerspaceSlug={team.makerspace.slug}
                  makerspaceName={team.makerspace.name}
                  lastManager={team.lastManager}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </AccountCard>
  );
}
