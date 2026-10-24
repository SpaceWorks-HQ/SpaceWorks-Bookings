import type { Metadata } from "next";
import { Suspense } from "react";
import { BrandHomeLink } from "@/components/chrome/SiteHeader";
import { MagicLinkSignIn } from "@/components/auth/MagicLinkSignIn";

export const metadata: Metadata = { title: "Sign in with your link", robots: { index: false, follow: false } };

/** Where the emailed sign-in link lands. Opening it signs nobody in; the button below does. */
export default function MagicLinkPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas px-4 py-5 sm:px-8 sm:py-6">
      <header>
        <BrandHomeLink />
      </header>
      <main id="main-content" tabIndex={-1} className="flex flex-1 items-center justify-center py-10 focus:outline-none">
        <div className="flex w-full max-w-[400px] flex-col gap-6">
          <Suspense fallback={<p className="text-body-ui text-ink-muted">Loading…</p>}>
            <MagicLinkSignIn />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
