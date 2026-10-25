import { loadMembers } from "@/lib/views/app__dashboard__makerspaceSlug__members__page";
import { MakerspacePageHeader } from "@/components/dashboard/makerspace/MakerspacePageHeader";
import { MembersPanel } from "@/components/members/MembersPanel";
import { Pagination } from "@/components/bookings/Pagination";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export const metadata = { title: "Members" };
export default async function Page(props: Parameters<typeof loadMembers>[0]) {
  const { makerspace, members, q, page, pages } = await loadMembers(props);
  return <div className="flex flex-col gap-6"><MakerspacePageHeader makerspace={makerspace} title="Members" description="Customers eligible for member rates." />
    <form className="flex flex-wrap items-end gap-3"><Field label="Search name or email"><Input name="q" type="search" defaultValue={q} /></Field><Button type="submit" variant="secondary">Search members</Button></form>
    <MembersPanel slug={makerspace.slug} members={members} /><Pagination page={page} pages={pages} query={{ q }} />
  </div>;
}
