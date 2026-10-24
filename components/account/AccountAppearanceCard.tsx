"use client";

import { Moon, Sun } from "lucide-react";
import { SegmentedControl } from "@/components/ui/choice";
import { useAppColorMode } from "@/components/providers";
import { AccountCard } from "@/components/account/AccountCard";
import type { ColorMode } from "@/lib/colorMode";

const OPTIONS = [
  { value: "light", label: "Light", icon: <Sun aria-hidden /> },
  { value: "dark", label: "Dark", icon: <Moon aria-hidden /> },
] as const satisfies ReadonlyArray<{ value: ColorMode; label: string; icon: React.ReactNode }>;

/** Colour mode for this browser: light or dark (there is no System option). */
export function AccountAppearanceCard() {
  const { mode, setColorMode } = useAppColorMode();
  return (
    <AccountCard id="account-appearance" title="Appearance" description="Choose how Space Works Bookings looks in this browser.">
      <div className="flex flex-col gap-2">
        <SegmentedControl<ColorMode>
          ariaLabel="Colour mode"
          value={mode}
          onValueChange={(next) => setColorMode(next)}
          options={OPTIONS}
          className="self-start"
        />
        <p className="text-caption text-ink-muted">Saved in this browser only.</p>
      </div>
    </AccountCard>
  );
}
