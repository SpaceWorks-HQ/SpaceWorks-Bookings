"use client";

import { addSpacePhoto, removeSpacePhoto, reorderSpacePhotos } from "@/app/actions/spaces";
import { ActionForm } from "@/components/bookings/ActionForm";
import { TextField } from "@/components/bookings/FormFields";
import { Card, CardHeader } from "@/components/ui/display";

export function SpacePhotos({ slug, spaceId, photos }: { slug: string; spaceId: string; photos: Array<{ id: string; url: string; alt: string }> }) {
  const scope = { makerspaceSlug: slug, spaceId };
  return <Card><CardHeader title="Photos" description="Upload an image up to 5 MB. The first photo is the cover." />
    <div className="mb-6 grid gap-4 sm:grid-cols-2">{photos.map((photo, index) => <div key={photo.id} className="flex flex-col gap-3">
      {/* User uploads are served by the configured storage origin. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="aspect-video w-full rounded-xl object-cover" src={photo.url} alt={photo.alt} />
      <p className="text-ink-secondary">Photo {index + 1}: {photo.alt || "No description"}</p>
      {index > 0 ? <ActionForm label="Move photo earlier" action={() => {
        const ids = photos.map((item) => item.id); [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
        return reorderSpacePhotos({ ...scope, photoIds: ids });
      }} /> : null}
      <ActionForm label="Remove photo" confirm="Remove this photo from the space?" action={() => removeSpacePhoto({ makerspaceSlug: slug, photoId: photo.id })} />
    </div>)}</div>
    {!photos.length ? <p className="mb-4 text-ink-muted">No photos yet. Add a clear view of the space.</p> : null}
    <ActionForm label="Upload photo" action={(data) => { data.set("makerspaceSlug", slug); data.set("spaceId", spaceId); return addSpacePhoto(data); }}>
      <TextField name="file" label="Image" type="file" required /><TextField name="alt" label="Image description" />
    </ActionForm>
  </Card>;
}
