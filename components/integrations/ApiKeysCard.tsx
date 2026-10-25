"use client";

import { useState } from "react";
import { createApiKey, revokeApiKey } from "@/app/actions/integrations";
import { ActionForm } from "@/components/bookings/ActionForm";
import { CheckField, TextField, text } from "@/components/bookings/FormFields";
import { Card, CardHeader, Callout, Chip } from "@/components/ui/display";
import { formatDayTime } from "@/lib/format/datetime";
import type { IntegrationsView } from "@/lib/views/app__dashboard__makerspaceSlug__settings__integrations__page";

/** Create and revoke REST API keys; a new key is shown once. */
export function ApiKeysCard({ slug, keys, timezone }: { slug: string; keys: IntegrationsView["keys"]; timezone: string }) {
  const [shown, setShown] = useState<string | null>(null);
  return <Card as="section"><CardHeader title="API keys" description={<>For other apps to read spaces and bookings, create bookings and keep member rates. See the <a className="underline underline-offset-4" href="/api/v1/openapi.json" target="_blank" rel="noopener">API reference</a>.</>} />
    {shown ? <Callout tone="warning" title="Copy this key now">It won&apos;t be shown again. <code className="mt-2 block break-all rounded-md bg-surface px-3 py-2 text-ink">{shown}</code></Callout> : null}
    <ul className="my-4 flex flex-col">{keys.length === 0 ? <li className="text-ink-muted">No API keys yet.</li> : keys.map((key) => <li key={key.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3">
      <div className="text-ink"><p className="font-semibold">{key.name}</p><p className="text-ink-muted">swb_{key.prefix}_… · {key.scopes.join(" and ")} · {key.lastUsedAt ? `last used ${formatDayTime(key.lastUsedAt, timezone)}` : "never used"}</p></div>
      {key.revokedAt ? <Chip>Revoked</Chip> : <ActionForm label="Revoke" confirm="Revoke this key? Apps using it stop working at once." action={() => revokeApiKey({ makerspaceSlug: slug, keyId: key.id })} />}
    </li>)}</ul>
    <ActionForm guard label="Create key" onSuccess={(data: { token: string }) => setShown(data.token)} action={(data) => createApiKey({ makerspaceSlug: slug, name: text(data, "name"), scopes: ["read", ...(data.get("write") ? ["write"] : [])] })}>
      <TextField name="name" label="Key name" helper="Where it is used, for example the membership app." required />
      <CheckField name="write" label="Allow writes (create and cancel bookings, member rates)" />
    </ActionForm>
  </Card>;
}
