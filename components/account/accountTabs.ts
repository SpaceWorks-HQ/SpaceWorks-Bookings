/** Tabs under the Account header. Add an entry here to add a tab. */
export type AccountTab = { href: string; label: string };

export const ACCOUNT_ROOT_HREF = "/account";

export const ACCOUNT_TABS: ReadonlyArray<AccountTab> = [
  { href: "/account/profile", label: "Profile" },
  { href: "/account/privacy", label: "Data and privacy" },
  { href: "/account/makerspaces", label: "Makerspaces" },
  { href: "/account/security", label: "Security" },
];

/** A tab matches its own path and everything nested under it (/account/security/anything). */
export function isAccountTabActive(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return path === href || path.startsWith(`${href}/`);
}
