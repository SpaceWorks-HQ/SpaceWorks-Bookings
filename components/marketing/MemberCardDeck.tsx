"use client";

import { useState } from "react";
import { RotateCw } from "lucide-react";
import { SpaceWorksLogo } from "@/components/brand/SpaceWorksLogo";
import { SAMPLE } from "./sample";

function ReceiptSlip() {
  // The total leads, so it stays readable with the card dealt over the slip's lower half.
  return (
    <div className="w-[300px] rounded-2xl border border-line bg-panel px-4 pb-16 pt-3.5 text-ink shadow-[0_18px_40px_-24px_rgb(20_44_42/0.45)]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-h3 tabular-nums">₹1,200.00</span>
        <span className="flex flex-col items-end text-[11px] leading-tight text-ink-muted">
          <span>Tax invoice · UPI</span>
          <span className="tabular-nums">{SAMPLE.receipt}</span>
        </span>
      </div>
    </div>
  );
}

function ReminderNote() {
  // The dateline sits at the bottom, the part that shows below the card.
  return (
    <div className="w-[290px] rounded-2xl bg-sw-sky px-4 pb-3.5 pt-10 text-sw-ink shadow-[0_18px_40px_-24px_rgb(20_44_42/0.45)]">
      <p className="text-label font-semibold">Your membership ends on 31 March.</p>
      <p className="mt-0.5 text-caption">1 Mar 2027 · renewal reminder</p>
    </div>
  );
}

const MONTHS = ["A", "M", "J", "J", "A", "S", "O", "N", "D", "J", "F", "M"];

/**
 * The hero: a receipt and a renewal reminder dealt behind the member card, which turns over to its
 * verification side. The QR is drawn on the server and passed in as SVG markup.
 */
export function MemberCardDeck({ qrSvg }: { qrSvg: string }) {
  const [flipped, setFlipped] = useState(false);

  return (
    <div className="relative mx-auto w-full max-w-[520px]">
      <div className="relative h-[330px] sm:h-[400px]">
        <div className="landing-deal absolute right-0 top-0 rotate-[4deg] max-sm:right-[-10px] max-sm:origin-top-right max-sm:scale-[0.82]" style={{ ["--deal-delay" as string]: "60ms", ["--deal-from" as string]: "16deg" }}>
          <div className="sr-drift-up">
            <ReceiptSlip />
          </div>
        </div>
        <div className="landing-deal absolute bottom-0 left-0 -rotate-[3deg] max-sm:left-[-8px] max-sm:origin-bottom-left max-sm:scale-[0.82]" style={{ ["--deal-delay" as string]: "180ms", ["--deal-from" as string]: "-12deg" }}>
          <div className="sr-drift-down">
            <ReminderNote />
          </div>
        </div>

        <div className="landing-deal absolute left-1/2 top-[52px] w-[min(400px,84vw)] -translate-x-1/2 sm:top-[62px]" style={{ ["--deal-delay" as string]: "320ms", ["--deal-from" as string]: "6deg" }}>
          <div className="sr-drift-card">
          <div className="landing-flip -rotate-[2deg]" data-flipped={flipped}>
            <div className="landing-flip-inner">
              {/* Front: what the member carries. */}
              <div className="landing-face landing-face-front flex aspect-[1.586] flex-col justify-between rounded-[22px] bg-sw-teal p-6 text-sw-cream shadow-[0_32px_70px_-30px_rgb(20_44_42/0.7)]" aria-hidden={flipped}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <SpaceWorksLogo variant="app-icon" height={30} label={null} />
                    <span className="text-label font-semibold">{SAMPLE.organisation}</span>
                  </div>
                  <span className="rounded-full bg-sw-citron px-3 py-0.5 text-caption font-semibold text-sw-ink">Valid</span>
                </div>
                <div>
                  <p className="text-caption opacity-80">{SAMPLE.role} · {SAMPLE.unit}</p>
                  <p className="text-[26px] font-extrabold leading-tight tracking-[-0.01em]">{SAMPLE.name}</p>
                  <p className="text-caption opacity-80">{SAMPLE.plan}</p>
                </div>
                <div className="flex items-end justify-between gap-3 whitespace-nowrap text-caption">
                  <span className="tabular-nums">{SAMPLE.cardNumber} · sample</span>
                  <span>Until {SAMPLE.validUntil}</span>
                </div>
              </div>
              {/* Back: what the person at the door scans. */}
              <div className="landing-face landing-face-back flex aspect-[1.586] items-center gap-5 rounded-[22px] border border-line bg-panel p-6 text-ink shadow-[0_32px_70px_-30px_rgb(20_44_42/0.7)]" aria-hidden={!flipped}>
                <div className="size-[124px] shrink-0 rounded-xl bg-sw-cream p-2.5 text-sw-ink [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="text-label font-semibold">Scan to check</p>
                  <p className="text-caption text-ink-secondary">Shows live status: valid, in grace, expired or revoked. The QR stays the same when the membership renews.</p>
                  <p className="text-caption tabular-nums text-ink-muted">{SAMPLE.cardNumber}</p>
                </div>
              </div>
            </div>
          </div>
          </div>
        </div>
      </div>
      <div className="mt-5 flex items-end justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5" role="img" aria-label="Membership year, April to March. The card was issued in April.">
          <div aria-hidden className="grid grid-cols-12 gap-1">
            {MONTHS.map((month, index) => (
              <span key={index} className={index === 0 ? "h-1.5 rounded-full bg-primary" : "h-1.5 rounded-full bg-emphasis"} />
            ))}
          </div>
          <div aria-hidden className="grid grid-cols-12 gap-1 text-[11px] tabular-nums text-ink-muted">
            {MONTHS.map((month, index) => (
              <span key={index} className={index === 0 ? "font-semibold text-ink" : undefined}>{month}</span>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setFlipped((value) => !value)}
          aria-pressed={flipped}
          className="inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control border border-line bg-panel px-3.5 text-caption font-semibold text-ink transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--sw-ui-focus))]"
        >
          <RotateCw aria-hidden className="size-3.5" />
          {flipped ? "Front" : "Turn over"}
        </button>
      </div>
    </div>
  );
}
