/**
 * The colour-mode switch animation (pure parts; components/providers.tsx runs it, app/styles/motion.css draws it).
 * The new mode grows as a circle from the control that changed it: a feathered edge where the browser can animate
 * a registered custom property inside a mask, a hard clip-path circle otherwise, a colour cross-fade without View
 * Transitions, and an instant switch under prefers-reduced-motion.
 */

export const REVEAL = { durationMs: 720, easing: "cubic-bezier(0.45, 0, 0.2, 1)", featherPx: 160, fadeMs: 420 } as const;

export type RevealStrategy = "instant" | "fade" | "circle" | "feathered";
export type Point = { x: number; y: number };
export type Viewport = { width: number; height: number };

export function revealStrategy(support: { reducedMotion: boolean; viewTransitions: boolean; featheredMask: boolean }): RevealStrategy {
  if (support.reducedMotion) return "instant";
  if (!support.viewTransitions) return "fade";
  return support.featheredMask ? "feathered" : "circle";
}

/** Where the circle starts: the control's point, kept inside the window; by default near the top-right toggle. */
export function revealOrigin(origin: Point | undefined, viewport: Viewport): Point {
  const point = origin ?? { x: viewport.width - 40, y: 32 };
  return { x: Math.min(Math.max(point.x, 0), viewport.width), y: Math.min(Math.max(point.y, 0), viewport.height) };
}

/** A radius that covers the farthest corner from the origin, plus the feathered edge so it ends fully opaque. */
export function revealRadius(origin: Point, viewport: Viewport, feather: number = REVEAL.featherPx): number {
  return Math.hypot(Math.max(origin.x, viewport.width - origin.x), Math.max(origin.y, viewport.height - origin.y)) + feather;
}

/** The centre of a control, for keyboard changes that have no pointer position. */
export function centreOf(rect: { left: number; top: number; width: number; height: number }): Point {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}
