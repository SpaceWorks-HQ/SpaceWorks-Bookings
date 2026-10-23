import Link from "next/link";
import { loadSpaces } from "@/lib/views/app__dashboard__makerspaceSlug__spaces__page";
import { words } from "@/lib/bookings/ui";
import { MakerspacePageHeader } from "@/components/dashboard/makerspace/MakerspacePageHeader";
import { Button } from "@/components/ui/button";
import { Card, Chip, EmptyState } from "@/components/ui/display";
import { NavTabs } from "@/components/ui/tabs";
import { Pagination } from "@/components/bookings/Pagination";

export const metadata = { title: "Spaces" };
export default async function Page(props: Parameters<typeof loadSpaces>[0]) {
  const { makerspace, rows, status, page, pages } = await loadSpaces(props);
  const base = `/dashboard/${makerspace.slug}/spaces`;
  return <div className="flex flex-col gap-6"><MakerspacePageHeader makerspace={makerspace} title="Spaces" description="Rooms, studios, desks and halls available to book."
    actions={<Button asChild><Link href={`${base}/new`}>Add space</Link></Button>} />
    <NavTabs label="Space status" items={["all", "published", "draft", "archived"].map((value) => ({ href: `?status=${value}`, label: words(value), active: value === status }))} />
    {!rows.length ? <EmptyState title="No spaces here">Add a space or choose a different status.</EmptyState> : <div className="grid gap-4 sm:grid-cols-2">{rows.map((row) => <Card key={row.id}>
      <div className="mb-3 flex items-center justify-between gap-3"><Link className="font-semibold text-accent-text underline-offset-4 hover:underline" href={`${base}/${row.id}`}>{row.name}</Link><Chip>{row.archivedAt ? "Archived" : row.published ? "Published" : "Draft"}</Chip></div>
      <p className="text-ink-secondary">{words(row.kind)} · Capacity {row.capacity} · {row.units} units</p>
    </Card>)}</div>}<Pagination page={page} pages={pages} query={{ status }} />
  </div>;
}
