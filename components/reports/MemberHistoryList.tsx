import type { HistoryEntry, MembershipCard } from "@/lib/reports/member";
import { formatCalendarDate, localDate } from "@/lib/membership/periods";
import { TermStatusChip } from "@/components/members/TermStatusChip";

/**
 * C1 and C2 for one member: their standing on each plan, then every change, newest first. Built for the
 * member portal (P8) and usable on the member page; feed it `loadMemberReport` output.
 */
export function MemberHistoryList({ membership, history, timezone }: { membership: MembershipCard[]; history: HistoryEntry[]; timezone: string }) {
  return (
    <div className="flex flex-col gap-5">
      <ul className="flex flex-col gap-2" aria-label="Memberships">
        {membership.map((card) => (
          <li key={card.planId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-panel px-4 py-3">
            <span className="min-w-0">
              <span className="block text-label font-semibold text-ink">{card.planName}</span>
              <span className="block text-caption text-ink-muted">
                {card.validUntil ? `Valid until ${formatCalendarDate(card.validUntil)}` : card.status === "ACTIVE" ? "Lifetime" : card.statusLabel}
                {card.memberSince ? ` · member since ${formatCalendarDate(card.memberSince)}` : ""}
                {card.renewalStartsOn ? ` · next year starts ${formatCalendarDate(card.renewalStartsOn)}` : ""}
              </span>
            </span>
            <TermStatusChip status={card.status} />
          </li>
        ))}
      </ul>
      {history.length ? (
        <ol className="flex flex-col border-l border-line pl-4" aria-label="Membership history">
          {history.map((entry, index) => (
            <li key={`${entry.termId}-${index}`} className="relative py-1.5">
              <span aria-hidden className="absolute -left-[21px] top-3 size-2 rounded-full bg-accent" />
              <span className="block text-label text-ink">{entry.label}</span>
              <span className="block text-caption text-ink-muted">{entry.planName} · {formatCalendarDate(localDate(entry.at, timezone))}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
