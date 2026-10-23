"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { leaveMakerspace } from "@/app/actions/account-makerspaces";
import { useToast } from "@/components/feedback/ToastProvider";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/menu";

const SOLE_OWNER_HINT = "Transfer ownership or delete the makerspace first.";

export function LeaveMakerspaceButton({
  makerspaceSlug,
  makerspaceName,
  soleOwner,
}: {
  makerspaceSlug: string;
  makerspaceName: string;
  soleOwner: boolean;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const hintId = useId();

  if (soleOwner) {
    // A disabled button gets no pointer events, so the focusable wrapper carries the tooltip.
    return (
      <Tooltip content={`You're the only owner. ${SOLE_OWNER_HINT}`}>
        <span tabIndex={0} aria-describedby={hintId} className="inline-flex rounded-full">
          <Button size="sm" variant="secondary" disabled>
            Leave
            <span className="sr-only"> {makerspaceName}</span>
          </Button>
          <span id={hintId} className="sr-only">You are the only owner. {SOLE_OWNER_HINT}</span>
        </span>
      </Tooltip>
    );
  }

  return (
    <>
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => setOpen(true)}>
        Leave
        <span className="sr-only"> {makerspaceName}</span>
      </Button>
      <ConfirmationDialog
        open={open}
        title={`Leave ${makerspaceName}?`}
        message="You will lose access to its dashboard straight away. An owner or space manager would need to invite you again. Your own bookings with this makerspace are not affected."
        confirmLabel="Leave makerspace"
        loading={pending}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          startTransition(async () => {
            const result = await leaveMakerspace({ makerspaceSlug });
            if (!result.ok) {
              showToast(result.error, "error");
              return;
            }
            setOpen(false);
            showToast(`You left ${makerspaceName}`, "success");
            router.refresh();
          });
        }}
      />
    </>
  );
}
