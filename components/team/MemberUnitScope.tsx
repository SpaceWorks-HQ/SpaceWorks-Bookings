"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTeamMemberUnit } from "@/app/actions/team";
import { useToast } from "@/components/feedback/ToastProvider";
import { Dropdown } from "@/components/ui/field";

/** Limit a manager to one unit and everything under it, or give them the whole organisation. */
export function MemberUnitScope({ organisationSlug, targetUserId, unitId, units, memberName }: {
  organisationSlug: string;
  targetUserId: string;
  unitId: string | null;
  units: Array<{ id: string; name: string; level: number }>;
  memberName?: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <Dropdown
      aria-label={memberName ? `What ${memberName} can see` : "What they can see"}
      value={unitId ?? ""}
      disabled={pending}
      className="w-auto min-w-[160px] max-w-[220px] py-2 text-sm"
      onChange={(e) => {
        const next = e.target.value || null;
        startTransition(async () => {
          const res = await setTeamMemberUnit({ organisationSlug, targetUserId, unitId: next });
          if (!res.ok) {
            showToast(res.error, "error");
            return;
          }
          showToast(next ? "Access limited to that unit" : "Access set to the whole organisation", "success");
          router.refresh();
        });
      }}
    >
      <option value="">Whole organisation</option>
      {units.map((unit) => <option key={unit.id} value={unit.id}>{`${"— ".repeat(unit.level)}${unit.name}`}</option>)}
    </Dropdown>
  );
}
