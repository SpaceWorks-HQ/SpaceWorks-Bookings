"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/app/actions/makerspace";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";
import { useToast } from "@/components/feedback/ToastProvider";
import { useUnsavedChangesGuard } from "@/components/forms/useUnsavedChangesGuard";

/** Shared pending, error, confirmation and unsaved-change behaviour for staff forms. */
export function ActionForm<T>({ children, action, label, confirm, onSuccess, guard = false, disabled = false }: {
  children?: ReactNode; action: (data: FormData) => Promise<ActionResult<T>>; label: string;
  confirm?: string; onSuccess?: (data: T) => void; guard?: boolean; disabled?: boolean;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [queued, setQueued] = useState<FormData | null>(null);
  useUnsavedChangesGuard(guard && dirty);
  function run(data: FormData) {
    setQueued(null);
    setError(null);
    start(async () => {
      try {
        const result = await action(data);
        if (!result.ok) {
          const details = Object.values(result.fieldErrors ?? {}).flat().join(" ");
          setError([result.error, details].filter(Boolean).join(" "));
          return;
        }
        setDirty(false);
        showToast(`${label}: done.`, "success");
        onSuccess?.(result.data as T);
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not save your changes. Please try again.");
      }
    });
  }
  return <>
    <form className="flex flex-col gap-4" onChange={() => setDirty(true)} onClick={(event) => {
      if (event.target instanceof Element && event.target.closest('button[type="button"]')) setDirty(true);
    }} onSubmit={(event) => {
      event.preventDefault(); if (disabled) return; const data = new FormData(event.currentTarget); if (confirm) setQueued(data); else run(data);
    }}>
      {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
      <fieldset disabled={pending || disabled} className="flex min-w-0 flex-col gap-4">{children}</fieldset>
      {!disabled ? <div><Button type="submit" variant={confirm ? "danger" : "primary"} loading={pending}>{label}</Button></div> : null}
    </form>
    <ConfirmationDialog open={queued !== null} title={`${label}?`} message={confirm ?? ""} confirmLabel={label}
      loading={pending} onCancel={() => setQueued(null)} onConfirm={() => { if (queued) run(queued); }} />
  </>;
}
