"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignMemberRoles } from "@/app/actions/members";
import { RoleChip } from "@/components/members/RoleChip";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/choice";
import { Callout, Card, CardHeader } from "@/components/ui/display";

type Role = { id: string; name: string; color: string };

/** Choose a member's organisation roles and which one prints on their card. */
export function MemberRolesPicker({ slug, memberId, roles, initial, initialPrimary, canManage }: { slug: string; memberId: string; roles: Role[]; initial: string[]; initialPrimary: string | null; canManage: boolean }) {
  const router = useRouter();
  const [chosen, setChosen] = useState(initial);
  const [primary, setPrimary] = useState<string | null>(initialPrimary ?? initial[0] ?? null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const changed = JSON.stringify([...chosen].sort()) !== JSON.stringify([...initial].sort()) || primary !== (initialPrimary ?? initial[0] ?? null);

  return (
    <Card as="section" className="rounded-xl">
      <CardHeader title="Roles" description="The main role prints on the member card." />
      {roles.length === 0 ? <p className="text-body-ui text-ink-secondary">No roles yet. Add them in Settings, under Units and roles.</p> : (
        <div className="flex flex-col gap-4">
          {status ? <Callout tone={status.ok ? "success" : "danger"} role={status.ok ? "status" : "alert"}>{status.text}</Callout> : null}
          <ul className="flex flex-col gap-2.5">
            {roles.map((role) => {
              const checked = chosen.includes(role.id);
              return (
                <li key={role.id} className="flex items-center gap-3">
                  <Checkbox
                    aria-label={role.name}
                    checked={checked}
                    disabled={!canManage}
                    onCheckedChange={(value) => {
                      setChosen((current) => (value === true ? [...current, role.id] : current.filter((id) => id !== role.id)));
                      if (value !== true && primary === role.id) setPrimary(null);
                      if (value === true && !primary) setPrimary(role.id);
                    }}
                  />
                  <RoleChip name={role.name} color={role.color} />
                  {checked ? (
                    <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-caption text-ink-secondary">
                      <input type="radio" name={`primary-${memberId}`} checked={primary === role.id} disabled={!canManage} onChange={() => setPrimary(role.id)} className="accent-[rgb(var(--sw-ui-primary))]" />
                      On card
                    </label>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {canManage ? (
            <div>
              <Button
                variant="secondary"
                disabled={!changed}
                loading={pending}
                onClick={() => startTransition(async () => {
                  const result = await assignMemberRoles({ organisationSlug: slug, memberId, roleIds: chosen, primaryRoleId: primary });
                  setStatus(result.ok ? { ok: true, text: "Roles saved." } : { ok: false, text: result.error });
                  router.refresh();
                })}
              >
                Save roles
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
