import "server-only";

import { cache } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";

/**
 * The makerspace behind a public page. Active and suspended makerspaces have one (a suspended one
 * says it isn't taking bookings); applications, refusals and archived makerspaces don't.
 */
export const loadPublicMakerspace = cache(async (slug: string) => {
  const makerspace = await prisma.makerspace.findUnique({
    where: { slug },
    select: {
      id: true, slug: true, name: true, kind: true, description: true, logoUrl: true, accentColor: true, status: true, visibility: true,
      city: true, stateCode: true, website: true, contactEmail: true, contactPhone: true, locale: true, timezone: true, currency: true,
    },
  });
  if (!makerspace || (makerspace.status !== "ACTIVE" && makerspace.status !== "SUSPENDED")) notFound();
  return makerspace;
});
