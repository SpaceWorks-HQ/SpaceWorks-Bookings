import { Globe, Mail, MapPin, Phone } from "lucide-react";
import { loadPublicMakerspacePage } from "@/lib/views/app__m__makerspaceSlug__page";
import { indianStateName } from "@/lib/indianStates";
import { Callout, Chip, EmptyState, MakerspaceLogo } from "@/components/ui/display";

export default async function PublicMakerspacePage({ params }: { params: Promise<{ makerspaceSlug: string }> }) {
  const { makerspace, takingBookings } = await loadPublicMakerspacePage({ params });
  const place = [makerspace.city, indianStateName(makerspace.stateCode)].filter(Boolean).join(", ");
  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-12 px-4 py-10 sm:px-6 lg:py-16">
      <section aria-labelledby="makerspace-name" className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex max-w-[720px] flex-col gap-5">
          <MakerspaceLogo name={makerspace.name} src={makerspace.logoUrl} size="xl" />
          <div className="flex flex-col gap-2">
            {makerspace.kind ? <Chip tone="outline" className="w-fit">{makerspace.kind}</Chip> : null}
            <h1 id="makerspace-name" className="text-display-m text-balance text-ink">{makerspace.name}</h1>
          </div>
          {makerspace.description ? <p className="whitespace-pre-wrap text-body-l text-ink-secondary">{makerspace.description}</p> : null}
        </div>
        <dl className="flex shrink-0 flex-col gap-3 rounded-2xl border border-line bg-panel p-5 text-body-ui lg:w-[300px]">
          {place ? <div className="flex items-center gap-2.5"><dt><MapPin aria-label="Location" className="size-4 text-ink-muted" /></dt><dd>{place}</dd></div> : null}
          {makerspace.contactEmail ? <div className="flex items-center gap-2.5"><dt><Mail aria-label="Email" className="size-4 text-ink-muted" /></dt><dd className="min-w-0 truncate"><a className="underline-offset-4 hover:underline" href={`mailto:${makerspace.contactEmail}`}>{makerspace.contactEmail}</a></dd></div> : null}
          {makerspace.contactPhone ? <div className="flex items-center gap-2.5"><dt><Phone aria-label="Phone" className="size-4 text-ink-muted" /></dt><dd><a className="underline-offset-4 hover:underline" href={`tel:${makerspace.contactPhone.replace(/\s/g, "")}`}>{makerspace.contactPhone}</a></dd></div> : null}
          {makerspace.website ? <div className="flex items-center gap-2.5"><dt><Globe aria-label="Website" className="size-4 text-ink-muted" /></dt><dd className="min-w-0 truncate"><a className="underline-offset-4 hover:underline" href={makerspace.website} rel="noopener noreferrer" target="_blank">{makerspace.website.replace(/^https?:\/\//, "")}</a></dd></div> : null}
        </dl>
      </section>

      <section aria-labelledby="spaces" className="flex flex-col gap-6">
        <h2 id="spaces" className="text-h1 text-ink">Spaces</h2>
        {takingBookings ? (
          <EmptyState mood="waiting" title="No spaces to book yet">
            {makerspace.name} hasn&apos;t opened any spaces for booking here yet. Contact them to ask.
          </EmptyState>
        ) : (
          <Callout tone="warning" title="Not taking bookings">{makerspace.name} isn&apos;t taking bookings right now.</Callout>
        )}
      </section>
    </div>
  );
}
