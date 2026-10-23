"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setMakerspaceVisibility } from "@/app/actions/super-admin-makerspaces";
import { SwitchRow } from "@/components/ui/choice";
import { Callout, Card, CardHeader } from "@/components/ui/display";

/** List the makerspace in the public directory, where anyone can find it and apply. */
export function MakerspaceVisibilityToggle({ makerspaceId, visibility, active }: { makerspaceId: string; visibility: "PUBLIC" | "UNLISTED"; active: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const listed = visibility === "PUBLIC";

  return (
    <Card as="section" className="rounded-xl">
      <CardHeader title="Public listing" description="Listed makerspaces appear on the Makerspaces page. Unlisted ones are reachable only by their link." />
      <div className="flex flex-col gap-3">
        {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
        <SwitchRow
          label="List in the public directory"
          description={!active && !listed ? "Only an active makerspace can be listed." : listed ? "Anyone can find it and book its spaces." : "Not listed."}
          checked={listed}
          disabled={pending || (!active && !listed)}
          onCheckedChange={(checked) => {
            setError(null);
            startTransition(async () => {
              const result = await setMakerspaceVisibility({ makerspaceId, visibility: checked ? "PUBLIC" : "UNLISTED" });
              if (!result.ok) setError(result.error);
              else router.refresh();
            });
          }}
        />
      </div>
    </Card>
  );
}
