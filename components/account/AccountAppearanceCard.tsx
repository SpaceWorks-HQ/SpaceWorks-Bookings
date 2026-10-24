"use client";

import { Moon, Sun } from "lucide-react";
import { SegmentedControl } from "@/components/ui/choice";
import { useAppColorMode } from "@/components/providers";
import { AccountCard } from "@/components/account/AccountCard";
import type { ColorMode } from "@/lib/colorMode";
import { centreOf, type Point } from "@/lib/colorModeReveal";
import { useRef } from "react";

const OPTIONS = [
  { value: "light", label: "Light", icon: <Sun aria-hidden /> },
  { value: "dark", label: "Dark", icon: <Moon aria-hidden /> },
] as const satisfies ReadonlyArray<{ value: ColorMode; label: string; icon: React.ReactNode }>;

/** Colour mode for this browser: light or dark (there is no System option). */
export function AccountAppearanceCard() {
  const { mode, setColorMode } = useAppColorMode();
  // Reveal the new mode from where the person clicked, or from the control itself for keyboard changes.
  const pointer = useRef<Point | null>(null);
  const control = useRef<HTMLDivElement>(null);
  return (
    <AccountCard id="account-appearance" title="Appearance" description="Choose how Space Works Bookings looks in this browser.">
      <div className="flex flex-col gap-2">
        <div ref={control} className="self-start" onPointerDownCapture={(event) => { pointer.current = { x: event.clientX, y: event.clientY }; }}>
        <SegmentedControl<ColorMode>
          ariaLabel="Colour mode"
          value={mode}
          onValueChange={(next) => {
            const origin = pointer.current ?? (control.current ? centreOf(control.current.getBoundingClientRect()) : undefined);
            pointer.current = null;
            setColorMode(next, origin);
          }}
          options={OPTIONS}
        />
        </div>
        <p className="text-caption text-ink-muted">Saved in this browser only.</p>
      </div>
    </AccountCard>
  );
}
