"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TeamRole } from "@prisma/client";
import { updateTeamRole, removeTeamMember } from "@/app/actions/team";
import { useToast } from "@/components/feedback/ToastProvider";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/display";
import { Dropdown } from "@/components/ui/field";
import { ROLE_LABELS } from "@/components/team/memberSummary";
import { assignableRoles, canManageTeamMember } from "@/lib/permissionRoles";

const ROLE_TONES = { OWNER: "ink", SPACE_MANAGER: "warning", BOOKINGS_MANAGER: "success", FRONT_DESK: "neutral", TREASURER: "info", VIEWER: "neutral" } as const satisfies Record<TeamRole, string>;

export function MemberRoleActions(props: {
  makerspaceSlug: string;
  targetUserId: string;
  role: TeamRole;
  actorRole: TeamRole;
  /** Used to label the role select and removal dialog for this row. */
  memberName?: string;
}) {
  const { makerspaceSlug, targetUserId, role, actorRole, memberName } = props;
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirmRemove, setConfirmRemove] = useState(false);

  const canEditRoles = role !== "OWNER" && canManageTeamMember(actorRole, role);
  const canRemove = role !== "OWNER" && canManageTeamMember(actorRole, role);
  // Roles below the actor's own; owners hand out any role but owner.
  const options = assignableRoles(actorRole);

  if (!canEditRoles && !canRemove) {
    return <Chip size="sm" tone={ROLE_TONES[role]}>{ROLE_LABELS[role]}</Chip>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canEditRoles ? (
        <Dropdown
          aria-label={memberName ? `Role for ${memberName}` : "Role"}
          value={role}
          disabled={pending}
          className="w-auto min-w-[160px] py-2 text-sm"
          onChange={(e) => {
            const next = e.target.value as TeamRole;
            startTransition(async () => {
              const res = await updateTeamRole({
                makerspaceSlug,
                targetUserId,
                role: next,
              });
              if (!res.ok) {
                showToast(res.error, "error");
                return;
              }
              showToast("Role updated", "success");
              router.refresh();
            });
          }}
        >
          {options.map((option) => (
            <option key={option} value={option}>{ROLE_LABELS[option]}</option>
          ))}
        </Dropdown>
      ) : (
        <Chip size="sm" tone={ROLE_TONES[role]}>{ROLE_LABELS[role]}</Chip>
      )}
      {canRemove ? (
        <Button size="sm" variant="dangerQuiet" disabled={pending} onClick={() => setConfirmRemove(true)}>
          Remove
          {memberName ? <span className="sr-only"> {memberName}</span> : null}
        </Button>
      ) : null}
      <ConfirmationDialog
        open={confirmRemove}
        title={memberName ? `Remove ${memberName} from the team?` : "Remove from the team?"}
        message="This person will immediately lose access to the makerspace dashboard."
        confirmLabel="Remove from team"
        loading={pending}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => {
          startTransition(async () => {
            const res = await removeTeamMember({
              makerspaceSlug,
              targetUserId,
            });
            if (!res.ok) {
              showToast(res.error, "error");
              return;
            }
            setConfirmRemove(false);
            showToast("Removed from the team", "success");
            router.refresh();
          });
        }}
      />
    </div>
  );
}
