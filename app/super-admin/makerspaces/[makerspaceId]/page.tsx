import { requireSuperAdmin } from "@/lib/permissions";
import { loadSuperAdminMakerspaceDetailView } from "@/lib/views/app__super-admin__makerspaces__makerspaceId__page";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AdminPanel, LinkRow, MetricRows, NameCell } from "@/components/super-admin/AdminPanel";
import { AuditTable } from "@/components/super-admin/AuditTable";
import { MakerspaceStatusChip } from "@/components/makerspace/MakerspaceStatusChip";
import { ReviewHistory } from "@/components/super-admin/ReviewHistory";
import { formatBytes } from "@/lib/superAdminInsights";
import { indianStateName } from "@/lib/indianStates";
import { MakerspaceDecisionPanel } from "@/components/super-admin/MakerspaceDecisionPanel";
import { MakerspaceLimitsForm } from "@/components/super-admin/MakerspaceLimitsForm";
import { OwnerInviteResend } from "@/components/super-admin/OwnerInviteResend";
import { MakerspaceVisibilityToggle } from "@/components/super-admin/MakerspaceVisibilityToggle";
import { ROLE_LABELS } from "@/lib/permissionRoles";
import { Chip, MakerspaceLogo, StatTile } from "@/components/ui/display";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

type Props = {
  params: Promise<{ makerspaceId: string }>;
};

export default async function SuperAdminMakerspaceDetailPage({ params }: Props) {
  await requireSuperAdmin();
  const { makerspace, reviews, members, invites, assetStats, auditEvents, now } = await loadSuperAdminMakerspaceDetailView({ params });
  const address = [makerspace.addressLine, makerspace.city, indianStateName(makerspace.stateCode), makerspace.postalCode].filter(Boolean).join(", ");
  const hasOwner = members.some((m) => m.role === "OWNER");
  const ownerInviteEmail = invites.find((invite) => invite.role === "OWNER" && invite.email)?.email ?? "";
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <Link href="/super-admin/makerspaces" className="inline-flex w-fit items-center gap-1 text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline">
          <ArrowLeft aria-hidden className="size-4" />
          Makerspaces
        </Link>
        <div className="flex items-center gap-4">
          <MakerspaceLogo name={makerspace.name} src={makerspace.logoUrl} size="lg" />
          <div className="min-w-0">
            <h1 className="break-words text-h1 text-ink">{makerspace.name}</h1>
            <p className="mt-0.5 text-sm text-ink-muted">
              {makerspace.source === "SUPERADMIN" ? "Added by a platform admin" : "Applied"} on {makerspace.createdAt.toLocaleDateString("en-GB")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <MakerspaceStatusChip status={makerspace.status} size="md" />
          <Chip tone="outline" className="tabular-nums">{`/m/${makerspace.slug}`}</Chip>
          <Chip tone="outline">{`${makerspace._count.teamMembers} on the team`}</Chip>
          {makerspace.visibility === "PUBLIC" ? <Chip tone="outline">Listed publicly</Chip> : null}
        </div>
        {makerspace.status === "ACTIVE" ? (
          <LinkRow links={[{ href: `/m/${makerspace.slug}`, label: "Public page" }, { href: `/dashboard/${makerspace.slug}`, label: "Makerspace dashboard" }]} />
        ) : null}
      </header>

      <MakerspaceDecisionPanel makerspaceId={makerspace.id} status={makerspace.status} />
      {!hasOwner && makerspace.status !== "REJECTED" ? <OwnerInviteResend makerspaceId={makerspace.id} defaultEmail={ownerInviteEmail} /> : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AdminPanel title="Application details">
          <MetricRows
            rows={[
              { label: "Kind", value: makerspace.kind || "—" },
              { label: "Contact email", value: makerspace.contactEmail ?? "—" },
              { label: "Contact phone", value: makerspace.contactPhone ?? "—" },
              { label: "Website", value: makerspace.website ?? "—" },
              { label: "Address", value: address || "—" },
            ]}
          />
          <p className="mt-4 whitespace-pre-wrap text-body-ui text-ink-secondary">{makerspace.description || "No description given."}</p>
        </AdminPanel>
        <AdminPanel title="Review history" description="Every decision, newest first.">
          <ReviewHistory reviews={reviews} />
        </AdminPanel>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid grid-cols-2 content-start gap-3">
          <StatTile className="rounded-xl" label="Team" value={makerspace._count.teamMembers.toLocaleString("en-IN")} />
          <StatTile className="rounded-xl" label="Stored files" value={assetStats._count._all.toLocaleString("en-IN")} hint={formatBytes(assetStats._sum.byteSize == null ? 0 : Number(assetStats._sum.byteSize))} />
        </div>
        <div className="flex flex-col gap-6">
          <MakerspaceVisibilityToggle makerspaceId={makerspace.id} visibility={makerspace.visibility} active={makerspace.status === "ACTIVE"} />
          <MakerspaceLimitsForm makerspaceId={makerspace.id} managerLimit={makerspace.managerLimit} />
        </div>
      </div>

      <AdminPanel title="Team">
        <Table label="Team">
          <THead>
            <tr>
              <TH>Person</TH>
              <TH>Role</TH>
              <TH>Joined</TH>
            </tr>
          </THead>
          <TBody>
            {members.length === 0 ? (
              <tr><TD colSpan={3} className="py-6 text-center text-ink-muted">No one on the team yet.</TD></tr>
            ) : (
              members.map((m) => (
                <TR key={m.id}>
                  <TD><NameCell href={`/super-admin/users/${m.user.id}`} name={m.user.name ?? m.user.email ?? "—"} sub={m.user.email ?? undefined} /></TD>
                  <TD><Chip size="sm" tone={m.role === "OWNER" ? "ink" : "neutral"}>{ROLE_LABELS[m.role]}</Chip></TD>
                  <TD className="whitespace-nowrap text-ink-secondary">{m.createdAt.toLocaleDateString("en-GB")}</TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </AdminPanel>

      <AdminPanel title="Team invites">
        <Table label="Team invites">
          <THead>
            <tr>
              <TH>Role</TH>
              <TH>For</TH>
              <TH>State</TH>
              <TH>Created</TH>
            </tr>
          </THead>
          <TBody>
            {invites.length === 0 ? (
              <tr><TD colSpan={4} className="py-6 text-center text-ink-muted">No invites.</TD></tr>
            ) : (
              invites.map((invite) => (
                <TR key={invite.id}>
                  <TD>{ROLE_LABELS[invite.role]}</TD>
                  <TD className="text-sm">{invite.email ?? "Anyone with the link"}</TD>
                  <TD>{invite.usedAt ? `Used by ${invite.usedBy?.email ?? "someone"}` : invite.expiresAt && invite.expiresAt <= now ? "Expired" : "Open"}</TD>
                  <TD className="whitespace-nowrap text-ink-secondary">{invite.createdAt.toLocaleDateString("en-GB")}</TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </AdminPanel>

      <AdminPanel title="Recent audit log">
        <AuditTable events={auditEvents} label="Recent audit log" hideMakerspace />
      </AdminPanel>
    </div>
  );
}
