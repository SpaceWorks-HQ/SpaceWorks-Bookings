"use client";

import { useState, useTransition } from "react";
import { setReportDigest } from "@/app/actions/report-digest";
import { SwitchRow } from "@/components/ui/choice";
import { Card } from "@/components/ui/display";

/** Your own monthly summary email for this organisation. */
export function DigestToggle({ slug, initial }: { slug: string; initial: boolean }) {
  const [enabled, setEnabled] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Card as="section" className="rounded-xl">
      <SwitchRow
        label="Email me a monthly summary"
        description={error ?? "On the first of each month: members, renewals, money and anything waiting for you."}
        checked={enabled}
        disabled={pending}
        onCheckedChange={(checked) => {
          setEnabled(checked);
          setError(null);
          startTransition(async () => {
            const result = await setReportDigest({ organisationSlug: slug, enabled: checked });
            if (!result.ok) {
              setEnabled(!checked);
              setError(result.error);
            }
          });
        }}
      />
    </Card>
  );
}
