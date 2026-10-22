const slugRegex = /[^a-z0-9]+/g;

export function slugifyTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(slugRegex, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "organisation";
}

export function withSlugSuffix(base: string, suffix: number): string {
  return suffix === 0 ? base : `${base}-${suffix}`;
}

/** Top-level routes an organisation slug would shadow (`/<orgSlug>`). */
export const RESERVED_ORGANISATION_SLUGS: ReadonlySet<string> = new Set([
  "about",
  "account",
  "api",
  "assets",
  "brand",
  "dashboard",
  "features",
  "join",
  "login",
  "members",
  "new",
  "o",
  "org",
  "pay",
  "plans",
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

/** Routes under `/o/<orgSlug>/` a plan slug would shadow. */
export const RESERVED_PLAN_SLUGS: ReadonlySet<string> = new Set(["join", "plans", "verify"]);

export function isReservedOrganisationSlug(slug: string) {
  return RESERVED_ORGANISATION_SLUGS.has(slug.trim().toLowerCase());
}

export function isReservedPlanSlug(slug: string) {
  return RESERVED_PLAN_SLUGS.has(slug.trim().toLowerCase());
}
