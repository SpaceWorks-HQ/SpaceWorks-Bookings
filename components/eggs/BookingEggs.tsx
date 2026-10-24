import { Patch } from "@/components/brand/Patch";

/**
 * Booking easter eggs (docs/DESIGN.md "Easter eggs"). Decorative only: hidden from assistive technology, never in
 * front of a control, and still under prefers-reduced-motion (app/styles/eggs.css).
 */

/** A rubber "Booked" stamp pressed onto a just-confirmed booking. No Patch: manage pages carry the makerspace's brand. */
export function BookedStamp() {
  return <span aria-hidden className="sw-stamp pointer-events-none select-none">Booked</span>;
}

/** Patch naps across an empty week of the calendar, with a few drifting z's. */
export function NappingPatch() {
  return <span aria-hidden className="relative inline-flex">
    <Patch pose="idle" size={88} />
    <span className="sw-nap-z pointer-events-none absolute right-2 top-1 text-ink-muted">
      <span>z</span><span>z</span><span>z</span>
    </span>
  </span>;
}

/** Everyone due today has checked in: Patch sneezes once, the sneeze kept for moments the community shares. */
export function AllHerePatch() {
  return <span aria-hidden className="inline-flex"><Patch pose="sneeze" size={72} /></span>;
}
