import Link from "next/link";
import type { Metadata } from "next";
import { loadPublicOrgLayout } from "@/lib/views/app__o__orgSlug__layout";
import { accentStyle } from "@/lib/theme/accent";
import { OrganisationFooter } from "@/components/chrome/SiteFooter";
import { ColorModeToggle } from "@/components/chrome/ColorModeToggle";
import { buttonClasses } from "@/components/ui/button";
import { OrgLogo } from "@/components/ui/display";

type Props = { children: React.ReactNode; params: Promise<{ orgSlug: string }> };

export async function generateMetadata({ params }: { params: Promise<{ orgSlug: string }> }): Promise<Metadata> {
  const { org } = await loadPublicOrgLayout({ params });
  return {
    title: { default: org.name, template: `%s · ${org.name}` },
    description: (org.page?.publishedAt && org.page.tagline) || org.description.slice(0, 160) || `${org.name} memberships`,
    // Unlisted organisations are reachable by link but stay out of search engines.
    robots: org.visibility === "PUBLIC" ? undefined : { index: false, follow: false },
  };
}

/** Public pages carry the organisation's own name and accent; Space Works steps back to the footer. */
export default async function PublicOrganisationLayout({ children, params }: Props) {
  const { org } = await loadPublicOrgLayout({ params });
  return (
    <div className="sw-accent-scope flex min-h-dvh flex-col bg-canvas" style={accentStyle((org.page?.publishedAt && org.page.accentColor) || org.accentColor)}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="border-b border-line bg-canvas">
        <div className="mx-auto flex w-full max-w-[1120px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href={`/o/${org.slug}`} className="flex min-w-0 items-center gap-3 rounded-md">
            <OrgLogo name={org.name} src={org.logoUrl} size="sm" />
            <span className="truncate text-label font-semibold text-ink">{org.name}</span>
          </Link>
          <nav aria-label="Account" className="flex items-center gap-2">
            <ColorModeToggle />
            <Link href={`/account`} className={buttonClasses({ variant: "secondary", size: "sm" })}>Your account</Link>
          </nav>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">{children}</main>
      <OrganisationFooter />
    </div>
  );
}
