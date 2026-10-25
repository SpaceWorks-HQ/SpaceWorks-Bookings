"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteMakerspace } from "@/app/actions/team";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";

/**
 * Bookings-manager-only delete. The confirmation stays locked until the makerspace's
 * exact name is typed; the server action still enforces ownership.
 */
export function DeleteMakerspaceButton(props: {
  makerspaceSlug: string;
  makerspaceName: string;
}) {
  const { makerspaceSlug, makerspaceName } = props;
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  // A fresh key per opening remounts the dialog so the typed name always starts empty.
  const [dialogKey, setDialogKey] = useState(0);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button
        variant="danger"
        onClick={() => {
          setDialogKey((key) => key + 1);
          setOpen(true);
        }}
      >
        Delete makerspace…
      </Button>
      <ConfirmDialog
        key={dialogKey}
        open={open}
        title={`Delete ${makerspaceName}?`}
        message="Everything this makerspace has set up here will be permanently removed. This can't be undone."
        confirmLabel="Delete"
        confirmText={makerspaceName}
        loading={pending}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          startTransition(async () => {
            const res = await deleteMakerspace({ makerspaceSlug });
            if (!res.ok) {
              showToast(res.error, "error");
              return;
            }
            setOpen(false);
            showToast("Makerspace deleted", "success");
            router.push("/dashboard");
          });
        }}
      />
    </>
  );
}
