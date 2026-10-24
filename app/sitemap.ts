import type { MetadataRoute } from "next";
import { loadSitemapMakerspaces } from "@/lib/views/app__sitemap";

// Reads listed makerspaces at request time, so the build never needs a database.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  const now = new Date();
  const fixed = ["/", "/makerspaces", "/privacy", "/terms"].map((path) => ({ url: `${baseUrl}${path}`, lastModified: now }));
  const makerspaces = await loadSitemapMakerspaces();
  return [...fixed, ...makerspaces.map((makerspace) => ({ url: `${baseUrl}/m/${makerspace.slug}`, lastModified: makerspace.updatedAt }))];
}
