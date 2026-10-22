"use client";

import { useState } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Sample cards: the team, with their roles, across four sample organisations on one instance.
 * Not real members or customers.
 */
const CARDS = [
  { org: "SpaceWorks", kind: "Systems Engineer", name: "Shaan Shoukath", until: "31 Mar 2027", tone: "teal" },
  { org: "Kunj-Company", kind: "Cloud Specialist", name: "Abhiram NJ", until: "31 Mar 2027", tone: "citron" },
  { org: "Ideologists", kind: "Full Stack Developer", name: "Abdul Samad MJ", until: "30 Jun 2027", tone: "ink" },
  { org: "Tinkerspace", kind: "Backend Engineer", name: "Midlaj C", until: "31 Dec 2026", tone: "sky" },
  { org: "Kunj-Company", kind: "Marketing Specialist", name: "Ajzal P", until: "31 Mar 2027", tone: "yellow" },
  { org: "Tinkerspace", kind: "App Developer", name: "Anin Arafath", until: "31 Dec 2026", tone: "orange" },
] as const;

const TONES: Record<(typeof CARDS)[number]["tone"], string> = {
  teal: "bg-sw-teal text-sw-cream",
  citron: "bg-sw-citron text-sw-ink",
  ink: "bg-sw-ink text-sw-cream",
  sky: "bg-sw-sky text-sw-ink",
  yellow: "bg-sw-yellow text-sw-ink",
  orange: "bg-sw-orange text-sw-ink",
  };

function MiniCard({ card }: { card: (typeof CARDS)[number] }) {
  return (
    <div className={cn("flex h-[132px] w-[220px] shrink-0 flex-col justify-between rounded-2xl p-4", TONES[card.tone])}>
      <div className="flex items-center justify-between gap-2 text-caption">
        <span className="truncate font-semibold">{card.org}</span>
        <span className="shrink-0 opacity-75">Sample</span>
      </div>
      <div>
        <p className="truncate text-label font-semibold">{card.name}</p>
        <p className="truncate text-caption opacity-80">Role · {card.kind}</p>
      </div>
      <p className="text-[11px] tabular-nums opacity-75">Valid until {card.until}</p>
    </div>
  );
}

/**
 * A slow conveyor of sample member cards under the hero. It pauses on hover and keyboard focus, has its
 * own pause button (moving content over five seconds must be stoppable), and stands still under reduced motion.
 */
export function CardStrip() {
  const [paused, setPaused] = useState(false);
  return (
    <div className="relative">
      <div className="landing-strip-mask overflow-hidden py-2">
        <div className="landing-strip flex w-max" data-paused={paused}>
          {/* Four identical sets, each with its trailing gap, so the loop is seamless on any screen width.
              Only the first set is read by assistive tech. */}
          {[0, 1, 2, 3].map((copy) => (
            <div key={copy} aria-hidden={copy > 0 || undefined} className="flex gap-4 pr-4">
              {CARDS.map((card) => <MiniCard key={`${copy}-${card.org}-${card.name}`} card={card} />)}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 px-4 sm:px-6">
        <p className="text-caption text-ink-muted">Sample cards from four organisations on one instance: SpaceWorks, Kunj-Company, Ideologists and Tinkerspace.</p>
        <button
          type="button"
          onClick={() => setPaused((value) => !value)}
          aria-pressed={paused}
          className="landing-strip-toggle inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-control px-3 text-caption font-semibold text-ink transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--sw-ui-focus))]"
        >
          {paused ? <Play aria-hidden className="size-3.5" /> : <Pause aria-hidden className="size-3.5" />}
          {paused ? "Play" : "Pause"}
        </button>
      </div>
    </div>
  );
}
