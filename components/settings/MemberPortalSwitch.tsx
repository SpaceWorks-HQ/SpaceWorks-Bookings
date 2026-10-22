"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setMemberPortal } from "@/app/actions/member-portal";
import { Callout } from "@/components/ui/display";
import { SwitchRow } from "@/components/ui/choice";

/** Whether members sign in to their own portal, or the organisation just keeps their records. */
export function MemberPortalSwitch({ slug, enabled, canEdit }: { slug: string; enabled: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
      <SwitchRow
        label="Members can sign in to their own account"
        description={on
          ? "Members see their memberships, pay, renew, download receipts and cards, ask for refunds and manage their details."
          : "Off: you keep members' records and payments yourselves. Members can't sign in for this organisation; payment emails carry a secure pay link, and scanning a member's card still shows whether they're current."}
        checked={on}
        disabled={!canEdit || pending}
        onCheckedChange={(checked) => {
          const next = checked === true;
          setOn(next);
          startTransition(async () => {
            const result = await setMemberPortal({ organisationSlug: slug, enabled: next });
            if (!result.ok) { setOn(!next); setError(result.error); return; }
            setError(null);
            router.refresh();
          });
        }}
      />
    </div>
  );
}
