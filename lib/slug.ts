const slugRegex = /[^a-z0-9]+/g;

export function slugifyTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(slugRegex, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "makerspace";
}

export function withSlugSuffix(base: string, suffix: number): string {
  return suffix === 0 ? base : `${base}-${suffix}`;
}

/** Top-level routes a makerspace slug would shadow (`/<makerspaceSlug>`). */
export const RESERVED_MAKERSPACE_SLUGS: ReadonlySet<string> = new Set([
  "about",
  "account",
  "api",
  "assets",
  "brand",
  "dashboard",
  "features",
  "join",
  "login",
  "new",
  "bookings",
  "m",
  "makerspace",
  "makerspaces",
  "o",
  "org",
  "pay",
  "privacy",
  "public",
  "receipts",
  "reset-password",
  "settings",
  "start",
  "static",
  "super-admin",
  "super-admin-mfa",
  "terms",
  "verify",
  "verify-email",
]);

export function isReservedMakerspaceSlug(slug: string) {
  return RESERVED_MAKERSPACE_SLUGS.has(slug.trim().toLowerCase());
}
