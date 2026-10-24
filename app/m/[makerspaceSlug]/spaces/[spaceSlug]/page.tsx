import Link from "next/link";
import Image from "next/image";
import { loadPublicSpacePage } from "@/lib/views/app__m__makerspaceSlug__spaces__spaceSlug__page";
import { capacityText, displayRates, isFreeSpace } from "@/lib/bookings/publicUi";
import { words } from "@/lib/bookings/ui";
import { money } from "@/lib/money/currencies";
import { Card, Callout } from "@/components/ui/display";
import { buttonClasses } from "@/components/ui/button";
import { PublicBookingForm } from "@/components/bookings/PublicBookingForm";

export default async function PublicSpacePage({ params }: { params: Promise<{ makerspaceSlug: string; spaceSlug: string }> }) {
  const { makerspace, space, rules, addOns, signedIn, contact, today } = await loadPublicSpacePage({ params });
  return <div className="mx-auto flex max-w-[1120px] flex-col gap-8 px-4 py-10 sm:px-6">
    <Link href={`/m/${makerspace.slug}`} className="underline underline-offset-4">All spaces at {makerspace.name}</Link>
    <h1 className="text-display-m">{space.name}</h1><p>{words(space.kind)} · {capacityText(space)}</p>
    {space.photos.length ? <div className="grid gap-4 sm:grid-cols-2">{space.photos.map((photo) => <Image key={photo.id} src={photo.url} alt={photo.alt || space.name} width={800} height={500} unoptimized className="aspect-[8/5] w-full rounded-xl object-cover" />)}</div> : null}
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 lg:grid-cols-2"><section className="flex flex-col gap-6" aria-label="About this space">
      <p className="whitespace-pre-wrap text-body-l">{space.description || space.summary}</p>
      {space.amenities.length ? <div><h2 className="text-h2">Amenities</h2><ul className="mt-3 list-inside list-disc">{space.amenities.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null}
      <Card><h2 className="text-h2">Prices</h2>{isFreeSpace(space) ? <p className="mt-3">Free to book.</p> : <ul className="mt-3">{displayRates(space).map((rate) => <li key={rate.label}>{money(rate.price, makerspace.currency)} {rate.label}{rate.member !== null ? ` · Members ${money(rate.member, makerspace.currency)}` : ""}</li>)}</ul>}<p className="mt-3 text-ink-secondary">Your quote includes any peak pricing, selected add-ons and tax. Member rates require a verified account.</p></Card>
      {addOns.length ? <section><h2 className="text-h2">Available add-ons</h2><ul className="mt-3 flex flex-col gap-3">{addOns.map((item) => <li key={item.id}><strong>{item.name}</strong> · {money(item.priceMinor, makerspace.currency)} · {words(item.unit)}{item.memberPriceMinor !== null && item.memberPriceMinor < item.priceMinor ? ` · Members ${money(item.memberPriceMinor, makerspace.currency)}` : ""}<p className="whitespace-pre-wrap text-ink-secondary">{item.description}</p></li>)}</ul></section> : null}
    </section><Card as="section"><h2 className="mb-6 text-h2">Book this space</h2>
      {makerspace.status !== "ACTIVE" ? <Callout tone="warning">This makerspace is not taking bookings right now.</Callout>
        : !signedIn && !rules.guestBookingAllowed ? <Callout title="Sign in to book"><p>This space accepts bookings from signed-in customers.</p><Link href={`/login?callbackUrl=${encodeURIComponent(`/m/${makerspace.slug}/spaces/${space.slug}`)}`} className={buttonClasses({ variant: "primary" })}>Sign in</Link></Callout>
          : <PublicBookingForm slug={makerspace.slug} spaceId={space.id} zone={makerspace.timezone} today={today} units={space.units} capacity={space.capacity} rules={rules} addOns={addOns} currency={makerspace.currency} contact={contact} />}
    </Card></div>
  </div>;
}
