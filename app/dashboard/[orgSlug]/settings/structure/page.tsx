import type { Metadata } from "next";
import { loadOrgStructureView } from "@/lib/views/app__dashboard__orgSlug__settings__structure__page";
import { OrgPageHeader } from "@/components/dashboard/org/OrgPageHeader";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { UnitLevelsEditor } from "@/components/settings/UnitLevelsEditor";
import { UnitTree } from "@/components/settings/UnitTree";
import { MemberRolesEditor } from "@/components/settings/MemberRolesEditor";
import { Callout, Card, CardHeader } from "@/components/ui/display";

export const metadata: Metadata = { title: "Units and roles", robots: { index: false, follow: false } };

export default async function OrgStructurePage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { org, canEdit, units, roles } = await loadOrgStructureView({ params });
  const unitOptions = units.filter((unit) => !unit.archivedAt).map(({ id, name, level }) => ({ id, name, level }));
  return (
    <div className="flex flex-col gap-6">
      <OrgPageHeader organisation={org} title="Settings" description="Units divide the organisation into regions, districts or chapters. Roles are the positions members hold." />
      <SettingsTabs slug={org.slug} />
      {!canEdit ? <Callout tone="info">You manage one unit, so the organisation&apos;s structure is read-only for you.</Callout> : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Card as="section" className="h-fit rounded-xl">
          <CardHeader title="Levels" description="Name each level of your structure, top first. Leave empty if you don't use units." />
          <UnitLevelsEditor slug={org.slug} initial={org.unitLevels} disabled={!canEdit} />
        </Card>
        <Card as="section" className="rounded-xl">
          <CardHeader title="Units" description="Members belong to one unit. Managers can be limited to a unit and everything under it, from the Team page." />
          <UnitTree slug={org.slug} levels={org.unitLevels} units={units} disabled={!canEdit} />
        </Card>
      </div>

      <Card as="section" className="rounded-xl">
        <CardHeader title="Member roles" description="Give members roles such as Secretary or Systems Engineer. A member's main role prints on their card." />
        <MemberRolesEditor slug={org.slug} roles={roles} units={unitOptions} disabled={!canEdit} />
      </Card>
    </div>
  );
}
