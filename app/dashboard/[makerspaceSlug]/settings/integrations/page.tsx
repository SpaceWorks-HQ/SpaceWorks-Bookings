import type { Metadata } from "next";
import { loadIntegrations } from "@/lib/views/app__dashboard__makerspaceSlug__settings__integrations__page";
import { MakerspacePageHeader } from "@/components/dashboard/makerspace/MakerspacePageHeader";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { ApiKeysCard } from "@/components/integrations/ApiKeysCard";
import { WebhooksCard } from "@/components/integrations/WebhooksCard";
import { Card, CardHeader, Chip } from "@/components/ui/display";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDayTime } from "@/lib/format/datetime";

export const metadata: Metadata = { title: "Integrations", robots: { index: false, follow: false } };

const STATUS = { PENDING: "Retrying", DELIVERED: "Delivered", FAILED: "Failed" } as const;

export default async function IntegrationsPage({ params }: { params: Promise<{ makerspaceSlug: string }> }) {
  const view = await loadIntegrations({ params });
  const zone = view.makerspace.timezone;
  return <div className="flex flex-col gap-6">
    <MakerspacePageHeader makerspace={view.makerspace} title="Settings" description="Connect other apps through the REST API and webhooks." />
    <SettingsTabs slug={view.makerspace.slug} />
    <ApiKeysCard slug={view.makerspace.slug} keys={view.keys} timezone={zone} />
    <WebhooksCard slug={view.makerspace.slug} endpoints={view.endpoints} events={view.events} />
    <Card as="section"><CardHeader title="Recent deliveries" description="The last 30 webhook deliveries, newest first." />
      {view.deliveries.length === 0 ? <p className="text-ink-muted">Nothing sent yet.</p> : <Table label="Recent deliveries"><THead><TR><TH>Event</TH><TH>When</TH><TH>Status</TH><TH>Answer</TH></TR></THead><TBody>
        {view.deliveries.map((delivery) => <TR key={delivery.id}><TD>{delivery.event}</TD><TD>{formatDayTime(delivery.createdAt, zone)}</TD>
          <TD><Chip tone={delivery.status === "DELIVERED" ? "success" : delivery.status === "FAILED" ? "danger" : "warning"}>{STATUS[delivery.status]}</Chip> <span className="text-ink-muted">{delivery.attempts} {delivery.attempts === 1 ? "try" : "tries"}</span></TD>
          <TD>{delivery.responseStatus ?? "No answer"}{delivery.lastError ? <span className="block text-ink-muted">{delivery.lastError}</span> : null}</TD></TR>)}
      </TBody></Table>}
    </Card>
  </div>;
}
