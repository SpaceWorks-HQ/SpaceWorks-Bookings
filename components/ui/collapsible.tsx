"use client";

import { useCallback, useId, useSyncExternalStore, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

/** A remembered open/closed choice in this browser, or null (nothing saved, or storage unavailable). */
export function readChoice(storageKey: string): boolean | null {
  try {
    const value = window.localStorage.getItem(storageKey);
    return value === "open" ? true : value === "closed" ? false : null;
  } catch {
    return null;
  }
}

export function saveChoice(storageKey: string, open: boolean) {
  try {
    window.localStorage.setItem(storageKey, open ? "open" : "closed");
  } catch {
    // Private windows and blocked storage just don't remember.
  }
}

export const readSectionChoice = (id: string) => readChoice(`swb:dash:${id}`);
export const saveSectionChoice = (id: string, open: boolean) => saveChoice(`swb:dash:${id}`, open);

const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/**
 * Open or closed, remembered per browser under `storageKey`. The server snapshot is null, so the server and the
 * first client render both use `defaultOpen` and the saved choice applies right after hydration.
 */
export function useRememberedOpen(storageKey: string, defaultOpen: boolean): [boolean, (open: boolean) => void] {
  const saved = useSyncExternalStore(subscribe, () => readChoice(storageKey), () => null);
  const setOpen = useCallback((open: boolean) => {
    saveChoice(storageKey, open);
    for (const listener of listeners) listener();
  }, [storageKey]);
  return [saved ?? defaultOpen, setOpen];
}

/**
 * A section that folds away (owner decision, 2026-10-24): the whole header is the toggle, with the title, an optional
 * count and a chevron; actions such as "View all" sit beside it, outside the button. It starts open when it has
 * something in it and folded when empty; a person's own choice is remembered in this browser (`swb:dash:<id>`).
 */
export function CollapsibleSection({ id, title, description, count, empty = false, defaultOpen, actions, className, children }: {
  id: string; title: ReactNode; description?: ReactNode; count?: number; empty?: boolean; defaultOpen?: boolean; actions?: ReactNode; className?: string; children: ReactNode;
}) {
  // Secondary sections pass defaultOpen={false}; otherwise a section starts open unless it is empty.
  const [open, setOpen] = useRememberedOpen(`swb:dash:${id}`, defaultOpen ?? !empty);
  const bodyId = useId();
  return (
    <section className={cn("flex min-w-0 flex-col rounded-xl border border-line bg-panel", className)}>
      <div className="flex items-start gap-3 p-4 sm:p-5">
        <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}
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
