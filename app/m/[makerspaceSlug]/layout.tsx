import Link from "next/link";
import type { Metadata } from "next";
import { loadPublicMakerspaceLayout } from "@/lib/views/app__m__makerspaceSlug__layout";
import { accentStyle } from "@/lib/theme/accent";
import { MakerspaceFooter } from "@/components/chrome/SiteFooter";
import { ColorModeToggle } from "@/components/chrome/ColorModeToggle";
import { buttonClasses } from "@/components/ui/button";
import { MakerspaceLogo } from "@/components/ui/display";

type Props = { children: React.ReactNode; params: Promise<{ makerspaceSlug: string }> };

export async function generateMetadata({ params }: { params: Promise<{ makerspaceSlug: string }> }): Promise<Metadata> {
  const { makerspace } = await loadPublicMakerspaceLayout({ params });
  return {
    title: { default: makerspace.name, template: `%s · ${makerspace.name}` },
    description: makerspace.description.slice(0, 160) || `Book a space at ${makerspace.name}`,
    // Unlisted makerspaces are reachable by link but stay out of search engines.
    robots: makerspace.visibility === "PUBLIC" ? undefined : { index: false, follow: false },
  };
}

/** Public pages carry the makerspace's own name and accent; Space Works steps back to the footer. */
export default async function PublicMakerspaceLayout({ children, params }: Props) {
  const { makerspace } = await loadPublicMakerspaceLayout({ params });
  return (
    <div className="sw-accent-scope flex min-h-dvh flex-col bg-canvas" style={accentStyle(makerspace.accentColor)}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="border-b border-line bg-canvas">
        <div className="mx-auto flex w-full max-w-[1120px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href={`/m/${makerspace.slug}`} className="flex min-h-11 min-w-0 items-center gap-3 rounded-md">
            <MakerspaceLogo name={makerspace.name} src={makerspace.logoUrl} size="sm" />
            <span className="truncate text-label font-semibold text-ink">{makerspace.name}</span>
          </Link>
          <nav aria-label="Account" className="flex items-center gap-2">
            <ColorModeToggle />
            <Link href={`/account`} className={buttonClasses({ variant: "secondary", size: "sm" })}>Your account</Link>
          </nav>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">{children}</main>
      <MakerspaceFooter />
    </div>
  );
}
