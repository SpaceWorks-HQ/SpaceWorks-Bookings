"use client";

import { useState } from "react";
import { createWebhookEndpoint, deleteWebhookEndpoint, pingWebhookEndpoint, rotateWebhookSecret, updateWebhookEndpoint } from "@/app/actions/integrations";
import { ActionForm } from "@/components/bookings/ActionForm";
import { CheckField, TextField, text } from "@/components/bookings/FormFields";
import { Card, CardHeader, Callout, Chip } from "@/components/ui/display";
import type { IntegrationsView } from "@/lib/views/app__dashboard__makerspaceSlug__settings__integrations__page";

const chosen = (data: FormData, events: string[]) => events.filter((event) => data.get(`event:${event}`));

function EventChecks({ events, selected }: { events: string[]; selected: string[] }) {
  return <fieldset className="grid gap-2 sm:grid-cols-2"><legend className="mb-2 text-ink-secondary">Events to send</legend>
    {events.map((event) => <CheckField key={event} name={`event:${event}`} label={event} checked={selected.includes(event)} />)}
  </fieldset>;
}

/** Outbound webhook endpoints: add, edit, switch off, rotate the secret, ping and remove. */
export function WebhooksCard({ slug, endpoints, events }: { slug: string; endpoints: IntegrationsView["endpoints"]; events: string[] }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [ping, setPing] = useState<string | null>(null);
  return <Card as="section"><CardHeader title="Webhooks" description="Signed POSTs to your URL when bookings, payments and refunds change. Payloads carry ids and amounts, never names or emails." />
    {secret ? <Callout tone="warning" title="Copy this signing secret now">It won&apos;t be shown again. <code className="mt-2 block break-all rounded-md bg-surface px-3 py-2 text-ink">{secret}</code></Callout> : null}
    {ping ? <Callout tone="info" role="status">{ping}</Callout> : null}
    <div className="my-4 flex flex-col gap-6">{endpoints.map((endpoint) => <section key={endpoint.id} className="flex flex-col gap-4 rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="break-all font-semibold text-ink">{endpoint.url}</p>
        <Chip tone={endpoint.isActive ? "success" : "danger"}>{endpoint.isActive ? (endpoint.consecutiveFailures ? `On, ${endpoint.consecutiveFailures} failing` : "On") : endpoint.disabledAt ? "Switched off after failures" : "Off"}</Chip></div>
      <ActionForm guard label="Save endpoint" action={(data) => updateWebhookEndpoint({ makerspaceSlug: slug, endpointId: endpoint.id, url: text(data, "url"), description: text(data, "description"), events: chosen(data, events), active: Boolean(data.get("active")) })}>
        <TextField name="url" label="URL" value={endpoint.url} required />
        <TextField name="description" label="Description" value={endpoint.description} />
        <EventChecks events={events} selected={endpoint.events} />
        <CheckField name="active" label="Send events to this endpoint" checked={endpoint.isActive} />
      </ActionForm>
      <div className="flex flex-wrap gap-4">
        <ActionForm label="Send a test ping" onSuccess={(data: { ok: boolean; status: number | null; error: string }) => setPing(data.ok ? `The endpoint answered ${data.status}.` : data.error)} action={() => pingWebhookEndpoint({ makerspaceSlug: slug, endpointId: endpoint.id })} />
        <ActionForm label="Rotate secret" confirm="Make a new signing secret? The old one stops working at once." onSuccess={(data: { secret: string }) => setSecret(data.secret)} action={() => rotateWebhookSecret({ makerspaceSlug: slug, endpointId: endpoint.id })} />
        <ActionForm label="Remove endpoint" confirm="Remove this endpoint and its delivery log?" action={() => deleteWebhookEndpoint({ makerspaceSlug: slug, endpointId: endpoint.id })} />
      </div>
    </section>)}</div>
    <h3 className="text-h4 text-ink">Add an endpoint</h3>
    <ActionForm guard label="Add endpoint" onSuccess={(data: { secret: string }) => setSecret(data.secret)} action={(data) => createWebhookEndpoint({ makerspaceSlug: slug, url: text(data, "url"), description: text(data, "description"), events: chosen(data, events) })}>
      <TextField name="url" label="URL" helper="A public https:// address." required />
      <TextField name="description" label="Description" />
      <EventChecks events={events} selected={events} />
    </ActionForm>
  </Card>;
}
