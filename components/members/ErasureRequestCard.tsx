"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideErasureRequest } from "@/app/actions/erasure";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { Callout, Card, CardHeader } from "@/components/ui/display";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import { formatCalendarDate, localDate } from "@/lib/membership/periods";

type Request = { id: string; status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN"; reason: string; createdAt: Date; decidedAt: Date | null; decisionNote: string | null };

const OUTCOME: Record<Request["status"], string> = { PENDING: "Waiting for a decision", APPROVED: "Approved: details erased", REJECTED: "Declined", WITHDRAWN: "Withdrawn by the member" };

/**
 * A member's request to erase their details, on their dashboard page. Approving anonymises them in this
 * organisation for good; declining needs a note, which the member receives by email.
 */
export function ErasureRequestCard({ slug, requests, anonymisedAt, canManage, timeZone }: { slug: string; requests: Request[]; anonymisedAt: Date | null; canManage: boolean; timeZone: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [dialog, setDialog] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [busy, startTransition] = useTransition();
  const day = (date: Date) => formatCalendarDate(localDate(date, timeZone));
  const open = requests.find((request) => request.status === "PENDING");
  if (requests.length === 0 && !anonymisedAt) return null;

  const decide = (decision: "approve" | "reject") => open && startTransition(async () => {
    const result = await decideErasureRequest({ organisationSlug: slug, requestId: open.id, decision, note });
    setDialog(null);
    showToast(result.ok ? (decision === "approve" ? "Details erased. The member has been told." : "Request declined. The member has been told.") : result.error, result.ok ? "success" : "error");
    if (result.ok) {
      setNote("");
      router.refresh();
    }
  });

  return (
    <Card as="section" className="rounded-xl">
      <CardHeader title="Erasure request" />
      <div className="flex flex-col gap-4">
        {anonymisedAt ? <Callout tone="info">This member&apos;s details were erased on {day(anonymisedAt)}. Their number, memberships and payments stay for your records.</Callout> : null}
        {open ? (
          <div className="flex flex-col gap-3 rounded-lg bg-warning-bg p-4 text-warning-fg">
            <p className="text-body-ui">Asked on {day(open.createdAt)} to erase their name, contact details and answers.</p>
            {open.reason ? <p className="text-body-ui">“{open.reason}”</p> : null}
            {canManage ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="dangerSolid" onClick={() => setDialog("approve")}>Approve and erase</Button>
                <Button size="sm" variant="secondary" onClick={() => setDialog("reject")}>Decline</Button>
              </div>
            ) : <p className="text-caption">An owner or manager decides this.</p>}
          </div>
        ) : null}
        {requests.filter((request) => request !== open).length ? (
          <ul className="flex flex-col gap-2 text-body-ui text-ink-secondary">
            {requests.filter((request) => request !== open).map((request) => (
              <li key={request.id}>
                {day(request.createdAt)}: {OUTCOME[request.status]}{request.decidedAt ? ` on ${day(request.decidedAt)}` : ""}{request.decisionNote ? ` (“${request.decisionNote}”)` : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <ConfirmDialog
        open={dialog === "approve"}
        title="Erase this member's details?"
        message="Their name, email, phone, photo, answers and roles are replaced for good, and any membership ends. Their member number, history and payment records stay. This can't be undone."
        confirmLabel="Erase details"
        confirmText="ERASE"
        loading={busy}
        onCancel={() => setDialog(null)}
        onConfirm={() => decide("approve")}
      />
      <ConfirmDialog
        open={dialog === "reject"}
        title="Decline this request?"
        message="Tell the member why. Your note is emailed to them."
        confirmLabel="Decline request"
        destructive={false}
        loading={busy}
        onCancel={() => setDialog(null)}
        onConfirm={() => decide("reject")}
      >
        <Field label="Reason" required>
          <Textarea value={note} rows={3} maxLength={1000} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </ConfirmDialog>
    </Card>
  );
}
