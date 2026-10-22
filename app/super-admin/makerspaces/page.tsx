import Link from "next/link";
import { Plus } from "lucide-react";
import { requireSuperAdmin } from "@/lib/permissions";
import { loadSuperAdminOrgsView } from "@/lib/views/app__super-admin__makerspaces__page";
import { AdminPager, AdminSearchForm, NameCell } from "@/components/super-admin/AdminPanel";
import { MAKERSPACE_STATUS_LABELS, MakerspaceStatusChip } from "@/components/makerspace/MakerspaceStatusChip";
import { buttonClasses } from "@/components/ui/button";
import { MakerspaceApplicationsControl } from "@/components/super-admin/MakerspaceApplicationsControl";
import { PageHeader } from "@/components/ui/display";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/cn";

type Props = {
  searchParams: Promise<{ q?: string; page?: string; status?: string }>;
};

export default async function SuperAdminOrgsPage({ searchParams }: Props) {
  await requireSuperAdmin();
  const { applicationsOpen, q, status, page, makerspaces, total, counts } = await loadSuperAdminOrgsView({ searchParams });
  const chip = (href: string, label: string, count: number, active: boolean) => (
    <Link
      key={href}
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors",
        active ? "border-primary bg-primary font-semibold text-on-primary" : "border-line bg-panel text-ink hover:bg-muted",
      )}
    >
      {label} <span className="tabular-nums">{count}</span>
    </Link>
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Makerspaces"
        description="Every makerspace on this platform. Applications wait under review until you decide."
        actions={
          <Link href="/super-admin/makerspaces/new" className={buttonClasses({ variant: "primary" })}>
            <Plus aria-hidden className="size-4" />
            Add makerspace
          </Link>
        }
      />
      <MakerspaceApplicationsControl initialEnabled={applicationsOpen} />
      <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
        {chip("/super-admin/makerspaces", "All", total, status === null)}
        {counts.filter((row) => row.count > 0 || row.status === "PENDING_REVIEW").map((row) =>
          chip(`/super-admin/makerspaces?status=${row.status}`, MAKERSPACE_STATUS_LABELS[row.status], row.count, status === row.status),
        )}
      </nav>
      <AdminSearchForm action="/super-admin/makerspaces" label="Search by name, address or contact email" defaultValue={q}>
        {status ? <input type="hidden" name="status" value={status} /> : null}
      </AdminSearchForm>

      <Table label="Makerspaces">
        <THead>
          <tr>
            <TH>Makerspace</TH>
            <TH>Status</TH>
            <TH className="text-right">Team</TH>
            <TH>{status === "PENDING_REVIEW" ? "Waiting since" : "Created"}</TH>
          </tr>
        </THead>
        <TBody>
          {makerspaces.length === 0 ? (
            <tr><TD colSpan={4} className="py-8 text-center text-ink-muted">{status ? "No makerspaces with this status." : "No makerspaces yet."}</TD></tr>
          ) : (
            makerspaces.map((o) => (
              <TR key={o.id}>
                <TD><NameCell href={`/super-admin/makerspaces/${o.id}`} name={o.name} sub={[`/m/${o.slug}`, o.kind, o.city].filter(Boolean).join(" · ")} /></TD>
                <TD><MakerspaceStatusChip status={o.status} /></TD>
                <TD className="text-right tabular-nums">{o._count.teamMembers}</TD>
                <TD className="whitespace-nowrap text-ink-secondary">{(status === "PENDING_REVIEW" ? o.updatedAt : o.createdAt).toLocaleDateString("en-GB")}</TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>

      <AdminPager basePath="/super-admin/makerspaces" query={q} page={page} extra={status ? `&status=${status}` : ""} />
    </div>
  );
}
