"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import { createUnit, renameUnit, setUnitArchived } from "@/app/actions/structure";
import { slugFromName } from "@/components/onboarding/SlugField";
import { Button, IconButton } from "@/components/ui/button";
import { Callout, Chip, EmptyState } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";

export type UnitRow = { id: string; name: string; slug: string; level: number; parentId: string | null; archivedAt: Date | null; members: number };

function UnitForm({ slug, parentId, levelName, onDone }: { slug: string; parentId: string | null; levelName: string; onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 sm:flex-row sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await createUnit({ organisationSlug: slug, name, slug: slugFromName(name), parentId });
          if (!result.ok) setError(result.error);
          else {
            router.refresh();
            onDone();
          }
        });
      }}
    >
      <Field label={`New ${levelName.toLowerCase()} name`} error={error ?? undefined} className="flex-1">
        <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus maxLength={80} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={pending} disabled={name.trim().length < 2}>Add</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

function UnitItem({ unit, slug, levels, disabled }: { unit: UnitRow; slug: string; levels: string[]; disabled: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "rename" | "add">("idle");
  const [name, setName] = useState(unit.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (task: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await task();
      if (!result.ok) setError(result.error ?? "Couldn't save.");
      else {
        setMode("idle");
        router.refresh();
      }
    });
  const childLevel = levels[unit.level + 1];

  return (
    <li className="flex flex-col gap-2">
      <div className={cn("flex min-h-12 flex-wrap items-center gap-3 rounded-xl px-3 py-2 hover:bg-subtle", unit.archivedAt && "opacity-60")} style={{ marginLeft: `${unit.level * 1.5}rem` }}>
        {mode === "rename" ? (
          <form className="flex flex-1 items-center gap-2" onSubmit={(event) => { event.preventDefault(); run(() => renameUnit({ organisationSlug: slug, unitId: unit.id, name })); }}>
            <Input aria-label="Unit name" value={name} onChange={(event) => setName(event.target.value)} autoFocus className="min-h-9" />
            <Button type="submit" size="sm" variant="primary" loading={pending}>Save</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode("idle")}>Cancel</Button>
          </form>
        ) : (
          <>
            <span className="min-w-0 flex-1">
              <span className="text-label font-semibold text-ink">{unit.name}</span>
              <span className="ml-2 text-caption text-ink-muted">{levels[unit.level] ?? "Unit"} · {unit.members} {unit.members === 1 ? "member" : "members"}</span>
            </span>
            {unit.archivedAt ? <Chip size="sm" tone="neutral">Archived</Chip> : null}
            {!disabled ? (
              <span className="flex items-center gap-1">
                {childLevel && !unit.archivedAt ? (
                  <Button size="sm" variant="ghost" onClick={() => setMode("add")}>
                    <Plus aria-hidden className="size-3.5" />
                    {childLevel}
                  </Button>
                ) : null}
                <IconButton label={`Rename ${unit.name}`} variant="quiet" size="sm" onClick={() => setMode("rename")}>
                  <Pencil aria-hidden className="size-3.5" />
                </IconButton>
                <IconButton
                  label={unit.archivedAt ? `Restore ${unit.name}` : `Archive ${unit.name} and everything under it`}
                  variant="quiet"
                  size="sm"
                  disabled={pending}
                  onClick={() => run(() => setUnitArchived({ organisationSlug: slug, unitId: unit.id, archived: !unit.archivedAt }))}
                >
                  {unit.archivedAt ? <ArchiveRestore aria-hidden className="size-3.5" /> : <Archive aria-hidden className="size-3.5" />}
                </IconButton>
              </span>
            ) : null}
          </>
        )}
      </div>
      {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
      {mode === "add" && childLevel ? (
        <div style={{ marginLeft: `${(unit.level + 1) * 1.5}rem` }}>
          <UnitForm slug={slug} parentId={unit.id} levelName={childLevel} onDone={() => setMode("idle")} />
        </div>
      ) : null}
    </li>
  );
}

/** The organisation's units as an indented tree. Archiving a unit archives everything under it. */
export function UnitTree({ slug, levels, units, disabled }: { slug: string; levels: string[]; units: UnitRow[]; disabled: boolean }) {
  const [adding, setAdding] = useState(false);
  if (levels.length === 0) return <EmptyState mood="sleepy">Name at least one level above to start adding units.</EmptyState>;
  return (
    <div className="flex flex-col gap-3">
      {units.length === 0 ? <EmptyState mood="sleepy">No units yet.</EmptyState> : (
        <ul className="flex flex-col gap-1">
          {units.map((unit) => <UnitItem key={unit.id} unit={unit} slug={slug} levels={levels} disabled={disabled} />)}
        </ul>
      )}
      {!disabled ? (adding ? <UnitForm slug={slug} parentId={null} levelName={levels[0]} onDone={() => setAdding(false)} /> : (
        <div>
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <Plus aria-hidden className="size-4" />
            Add a {levels[0].toLowerCase()}
          </Button>
        </div>
      )) : null}
    </div>
  );
}
