"use client";

import { useRouter } from "next/navigation";
import { createSpace, updateSpace, setSpaceArchived } from "@/app/actions/spaces";
import type { SpaceFields } from "@/lib/spaces/schemas";
import { ActionForm } from "@/components/bookings/ActionForm";
import { CheckField, TextField, NotesField, SelectField, number, text } from "@/components/bookings/FormFields";
import { Card, CardHeader } from "@/components/ui/display";

export function SpaceDetailsForm({ slug, initial }: { slug: string; initial?: Partial<SpaceFields> & { id: string; archivedAt: string | null } }) {
  const router = useRouter();
  return <Card><CardHeader title="Space details" description="Save as a draft until the photos, prices and opening hours are ready." />
    <ActionForm guard label={initial ? "Save space" : "Create space"} action={(data) => {
      const fields = { name: text(data, "name"), ...(text(data, "slug") ? { slug: text(data, "slug") } : {}), kind: text(data, "kind"),
        summary: text(data, "summary"), description: text(data, "description"), capacity: number(data, "capacity"), units: number(data, "units"),
        amenities: text(data, "amenities").split(",").map((item) => item.trim()).filter(Boolean), colour: text(data, "colour") || null,
        published: data.has("published"), sortOrder: number(data, "sortOrder") };
      return initial ? updateSpace({ makerspaceSlug: slug, spaceId: initial.id, fields }) : createSpace({ makerspaceSlug: slug, fields });
    }} onSuccess={(space) => { if (!initial) router.push(`/dashboard/${slug}/spaces/${space.id}`); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="name" label="Name" value={initial?.name} required />
        <TextField name="slug" label="Address slug" value={initial?.slug} helper="Lowercase letters, numbers and hyphens. Leave blank to generate." />
        <SelectField name="kind" label="Kind" value={initial?.kind ?? "ROOM"} options={["ROOM", "STUDIO", "DESK", "HALL", "OTHER"]} />
        <TextField name="capacity" label="People per unit" type="number" min={0} max={100000} value={initial?.capacity ?? 1} required />
        <TextField name="units" label="Identical units" type="number" min={1} max={500} value={initial?.units ?? 1} required />
        <TextField name="sortOrder" label="Sort order" type="number" min={0} max={10000} value={initial?.sortOrder ?? 0} required />
        <SelectField name="colour" label="Colour token" value={initial?.colour ?? ""} options={[{ value: "", label: "Default" }, "teal", "citron", "sky", "yellow", "orange", "ink", "cream"]} />
        <TextField name="amenities" label="Amenities (comma separated)" value={initial?.amenities?.join(", ")} />
      </div>
      <TextField name="summary" label="Summary" value={initial?.summary} />
      <NotesField name="description" label="Description" value={initial?.description} maxLength={10000} />
      <CheckField name="published" label="Published" checked={initial?.published} />
    </ActionForm>
    {initial ? <div className="mt-6 border-t border-line pt-5"><ActionForm label={initial.archivedAt ? "Restore space" : "Archive space"}
      confirm={initial.archivedAt ? "Restore this space as a draft?" : "Hide this space and stop new bookings? Existing bookings stay in place."}
      action={() => setSpaceArchived({ makerspaceSlug: slug, spaceId: initial.id, archived: !initial.archivedAt })} /></div> : null}
  </Card>;
}
