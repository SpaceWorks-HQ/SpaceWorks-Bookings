"use client";

import { useState } from "react";
import { issueStaffCalendarFeed, revokeStaffCalendarFeed } from "@/app/actions/bookings-staff";
import { Card, CardHeader, Callout } from "@/components/ui/display";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/feedback/ToastProvider";
import { ActionForm } from "./ActionForm";

export function CalendarFeedCard({ slug, feed }: { slug: string; feed: { tokenHint: string } | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const { showToast } = useToast();
  return <Card><CardHeader title="Staff calendar feed" description="Subscribe to live bookings in your calendar. Anyone with this private URL can read the feed. The URL is shown once." />
    {feed ? <p className="mb-3 text-ink-secondary">Active feed ending {feed.tokenHint}.</p> : null}
    {url ? <Callout role="status"><Field label="Private feed URL"><Input readOnly value={url} onFocus={(event) => event.target.select()} /></Field>
      <div className="mt-2 flex gap-3"><Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(url); showToast("Feed URL copied.", "success"); } catch { showToast("Select and copy the feed URL.", "info"); } }}>Copy URL</Button>
        <Button variant="quiet" onClick={() => setUrl(null)}>Hide URL</Button></div>
    </Callout> : null}
    <div className="mt-4 flex flex-wrap gap-4"><ActionForm label={feed ? "Replace feed URL" : "Issue feed URL"} confirm={feed ? "Replace the secret URL? Existing calendar subscriptions will stop working." : undefined}
      action={() => issueStaffCalendarFeed({ makerspaceSlug: slug })} onSuccess={(data) => setUrl(`${window.location.origin}/api/calendar/${data.token}`)} />
      {feed ? <ActionForm label="Revoke feed" confirm="Stop this calendar subscription?" action={() => revokeStaffCalendarFeed({ makerspaceSlug: slug })} onSuccess={() => setUrl(null)} /> : null}
    </div>
  </Card>;
}
