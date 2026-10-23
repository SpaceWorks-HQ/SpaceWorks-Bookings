"use client";
import { useState, useTransition } from "react";
import { issuePersonalCalendarFeed, revokePersonalCalendarFeed } from "@/app/actions/bookings-public";
import { Card, CardHeader, Callout } from "@/components/ui/display";
import { Field, Input, Dropdown } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export function PersonalCalendarCard({ makerspaces }: { makerspaces: Array<{ slug: string; name: string; feed: { tokenHint: string } | null }> }) {
  const [slug, setSlug] = useState(makerspaces[0]?.slug ?? "");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const feed = makerspaces.find((row) => row.slug === slug)?.feed;
  return <Card><CardHeader title="Your personal calendar feed" description="Subscribe to your bookings at a makerspace. Anyone with this private URL can read the feed. The URL is shown once; replacing it stops existing subscriptions." />
    {!makerspaces.length ? <p>Your calendar feed will be available after your first booking.</p> : <div className="flex flex-col gap-4">
      <Field label="Makerspace"><Dropdown value={slug} disabled={pending} onChange={(event) => { setSlug(event.target.value); setUrl(null); setError(""); }}>{makerspaces.map((row) => <option key={row.slug} value={row.slug}>{row.name}</option>)}</Dropdown></Field>
      {feed ? <p>Active feed ending {feed.tokenHint}.</p> : null}
      {url ? <Callout role="status"><Field label="Private calendar URL"><Input readOnly value={url} onFocus={(event) => event.target.select()} /></Field><Button className="mt-2" onClick={() => setUrl(null)}>Hide URL</Button></Callout> : null}
      <div className="flex flex-wrap gap-3"><Button disabled={pending} onClick={() => startTransition(async () => {
        setError(""); try { const result = await issuePersonalCalendarFeed({ makerspaceSlug: slug });
          if (!result.ok) { setError(result.error); return; } if (!result.data) return; setUrl(`${window.location.origin}/api/calendar/${result.data.token}`); router.refresh();
        } catch { setError("Could not issue a calendar URL. Please try again."); }
      })}>{feed ? "Replace feed URL" : "Issue feed URL"}</Button>
        {feed || url ? <Button disabled={pending} variant="danger" onClick={() => startTransition(async () => {
          setError(""); try { const result = await revokePersonalCalendarFeed({ makerspaceSlug: slug });
            if (!result.ok) { setError(result.error); return; } setUrl(null); router.refresh();
          } catch { setError("Could not revoke the calendar URL. Please try again."); }
        })}>Revoke feed</Button> : null}</div>
      {error ? <Callout role="alert" tone="danger">{error}</Callout> : null}
    </div>}
  </Card>;
}
