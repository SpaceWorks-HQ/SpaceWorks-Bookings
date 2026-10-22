"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Opens the browser's print dialog ("Save as PDF") once the charts have drawn, and on demand. */
export function PrintButton({ auto = false }: { auto?: boolean }) {
  useEffect(() => {
    if (!auto) return;
    const timer = window.setTimeout(() => window.print(), 600);
    return () => window.clearTimeout(timer);
  }, [auto]);
  return (
    <Button className="sw-print-hide" onClick={() => window.print()}>
      <Printer aria-hidden className="size-4" />
      Print or save as PDF
    </Button>
  );
}
