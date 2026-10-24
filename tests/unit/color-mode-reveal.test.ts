import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REVEAL, centreOf, revealOrigin, revealRadius, revealStrategy } from "@/lib/colorModeReveal";

describe("colour-mode reveal", () => {
  it("switches instantly under reduced motion, fades without View Transitions, and feathers where it can", () => {
    expect(revealStrategy({ reducedMotion: true, viewTransitions: true, featheredMask: true })).toBe("instant");
    expect(revealStrategy({ reducedMotion: false, viewTransitions: false, featheredMask: true })).toBe("fade");
    expect(revealStrategy({ reducedMotion: false, viewTransitions: true, featheredMask: false })).toBe("circle");
    expect(revealStrategy({ reducedMotion: false, viewTransitions: true, featheredMask: true })).toBe("feathered");
  });

  it("starts at the control, inside the window, or near the top-right toggle by default", () => {
    const viewport = { width: 1280, height: 800 };
    expect(revealOrigin(undefined, viewport)).toEqual({ x: 1240, y: 32 });
    expect(revealOrigin({ x: 100, y: 200 }, viewport)).toEqual({ x: 100, y: 200 });
    expect(revealOrigin({ x: -20, y: 9000 }, viewport)).toEqual({ x: 0, y: 800 });
    expect(centreOf({ left: 10, top: 20, width: 40, height: 20 })).toEqual({ x: 30, y: 30 });
  });

  it("grows far enough to cover the farthest corner, feathered edge included", () => {
    const viewport = { width: 1280, height: 800 };
    expect(revealRadius({ x: 1240, y: 32 }, viewport)).toBeCloseTo(Math.hypot(1240, 768) + REVEAL.featherPx);
    expect(revealRadius({ x: 640, y: 400 }, viewport, 0)).toBeCloseTo(Math.hypot(640, 400));
  });

  it("keeps the CSS in step with the timing (720 ms, feathered mask, fade fallback, reduced motion)", () => {
    expect(REVEAL).toMatchObject({ durationMs: 720, easing: "cubic-bezier(0.45, 0, 0.2, 1)" });
    const css = readFileSync(path.join(process.cwd(), "app/styles/motion.css"), "utf8");
    expect(css).toContain("@property --sw-reveal");
    expect(css).toContain(".sw-theme-reveal-soft::view-transition-new(root)");
    expect(css).toMatch(/\.sw-theme-fade[\s\S]*transition-duration: 420ms/);
    expect(css).toContain("prefers-reduced-motion");
  });
});
