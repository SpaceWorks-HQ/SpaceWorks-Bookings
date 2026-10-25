"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

const KEY = (id: string) => `swb:dash:${id}`;

/** The remembered choice for a section in this browser, or null (nothing saved, or storage unavailable). */
export function readSectionChoice(id: string): boolean | null {
  try {
    const value = window.localStorage.getItem(KEY(id));
    return value === "open" ? true : value === "closed" ? false : null;
  } catch {
    return null;
  }
}

export function saveSectionChoice(id: string, open: boolean) {
  try {
    window.localStorage.setItem(KEY(id), open ? "open" : "closed");
  } catch {
    // Private windows and blocked storage just don't remember.
  }
}

/**
 * A dashboard section that folds away (owner decision, 2026-10-24): the whole header is the toggle, with the title,
 * an optional count and a chevron; actions such as "View all" sit beside it, outside the button. It starts open when
 * it has something in it and folded when empty; a person's own choice is remembered in this browser, read after
 * hydration so the server and first client render agree.
 */
export function CollapsibleSection({ id, title, description, count, empty = false, actions, className, children }: {
  id: string; title: ReactNode; description?: ReactNode; count?: number; empty?: boolean; actions?: ReactNode; className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(!empty);
  const bodyId = useId();
  useEffect(() => {
    const saved = readSectionChoice(id);
    if (saved === null) return;
    const frame = requestAnimationFrame(() => setOpen(saved));
    return () => cancelAnimationFrame(frame);
  }, [id]);
  const toggle = () => {
    saveSectionChoice(id, !open);
    setOpen(!open);
  };
  return (
    <section className={cn("flex min-w-0 flex-col rounded-xl border border-line bg-panel", className)}>
      <div className="flex items-start gap-3 p-4 sm:p-5">
        <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={toggle}
          className="flex min-h-11 min-w-0 flex-1 items-start gap-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--sw-ui-focus))]">
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2 text-title text-ink">
              {title}
              {count !== undefined ? <span className="rounded-full bg-surface px-2 text-caption font-semibold tabular-nums text-ink-secondary">{count.toLocaleString("en-IN")}</span> : null}
            </span>
            {description ? <span className="mt-0.5 block text-label text-ink-muted">{description}</span> : null}
          </span>
          <ChevronDown aria-hidden className={cn("mt-1 size-5 shrink-0 text-ink-muted transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} />
        </button>
        {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
      </div>
      <div id={bodyId} hidden={!open} className="min-w-0 px-4 pb-4 sm:px-5 sm:pb-5">{children}</div>
    </section>
  );
}
