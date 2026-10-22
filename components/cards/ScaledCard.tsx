"use client";

import { useEffect, useRef, useState } from "react";
import type { CardSideSettings } from "@/lib/cards/design/elements";
import type { CardBranding, CardHolder } from "@/lib/cards/types";
import { CardCanvas } from "./CardCanvas";

/** A static card side that fills its container's width, drawn by the shared card canvas. */
export function ScaledCard({ settings, holder, branding }: { settings: CardSideSettings; holder: CardHolder; branding: CardBranding }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="size-full">
      {width > 0 ? <CardCanvas settings={settings} holder={holder} branding={branding} pxPerMm={width / settings.widthMm} /> : null}
    </div>
  );
}
