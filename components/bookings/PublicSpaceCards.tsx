import Link from "next/link";
import Image from "next/image";
import type { Space, SpacePhoto } from "@prisma/client";
import { Card } from "@/components/ui/display";
import { capacityText, displayRates, isFreeSpace } from "@/lib/bookings/publicUi";
import { words } from "@/lib/bookings/ui";
import { money } from "@/lib/money/currencies";

export function PublicSpaceCards({ spaces, slug, currency }: { spaces: Array<Space & { photos: SpacePhoto[] }>; slug: string; currency: string }) {
  return <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{spaces.map((space) => {
    const rate = displayRates(space).sort((a, b) => a.price - b.price)[0];
    return <Card key={space.id} className="flex flex-col gap-3">
      {space.photos[0] ? <Image src={space.photos[0].url} alt={space.photos[0].alt || space.name} width={600} height={400} unoptimized className="aspect-[3/2] w-full rounded-xl object-cover" /> : null}
      <h3 className="text-h3"><Link className="underline-offset-4 hover:underline" href={`/m/${slug}/spaces/${space.slug}`}>{space.name}</Link></h3>
      <p>{words(space.kind)} · {capacityText(space)}</p>
      {space.summary ? <p className="text-ink-secondary">{space.summary}</p> : null}
      {isFreeSpace(space) ? <p>Free to book</p> : rate ? <p>From {money(rate.price, currency)} {rate.label}{rate.member !== null ? <span className="block text-ink-secondary">Members from {money(rate.member, currency)} {rate.label}</span> : null}</p> : <p>Contact the makerspace for prices.</p>}
    </Card>;
  })}</div>;
}
