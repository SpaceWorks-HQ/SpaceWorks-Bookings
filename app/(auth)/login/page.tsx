import { loadLoginView } from "@/lib/views/app__auth__login__page";
import { Suspense } from "react";
import { Check } from "lucide-react";
import { LoginForm } from "./ui";
import { BrandHomeLink } from "@/components/chrome/SiteHeader";
import { SpaceWorksLogo } from "@/components/brand/SpaceWorksLogo";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };

/** An illustrative membership card for the brand panel (product proof, not live data). */
function SampleCard({ name, plan, number, until, className }: { name: string; plan: string; number: string; until: string; className?: string }) {
  return (
    <div className={`flex w-full max-w-[340px] flex-col gap-4 rounded-2xl bg-primary p-5 text-on-primary ${className ?? ""}`}>
      <span className="flex items-center justify-between gap-3">
        <span className="text-overline">Member</span>
        <span className="rounded-full bg-sw-citron px-2.5 py-0.5 text-caption font-semibold text-sw-ink">Valid</span>
      </span>
      <span className="flex flex-col">
        <span className="text-h4 text-on-primary">{name}</span>
        <span className="text-caption opacity-90">{plan}</span>
      </span>
      <span className="flex items-end justify-between gap-3 text-caption">
        <span className="tabular-nums">{number}</span>
        <span>Valid until {until}</span>
      </span>
    </div>
  );
}

/** An illustrative renewal row for the brand panel. */
function SampleRow({ title, meta, className }: { title: string; meta: string; className?: string }) {
  return (
    <div className={`flex items-center gap-3.5 rounded-xl border border-line bg-panel p-4 ${className ?? ""}`}>
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-sw-sky text-label font-semibold text-sw-ink">AN</span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-label text-ink">{title}</span>
        <span className="truncate text-caption text-ink-muted">{meta}</span>
      </span>
    </div>
  );
}

export default async function LoginPage() {
  const { providers, accountCreationEnabled } = await loadLoginView();
  return (
    <div className="grid min-h-dvh bg-canvas md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col px-4 py-5 sm:px-8 sm:py-6">
        <header>
          <BrandHomeLink />
        </header>
        <main id="main-content" tabIndex={-1} className="flex flex-1 items-center justify-center py-10 focus:outline-none">
          <div className="flex w-full max-w-[400px] flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h1 className="text-display-l text-ink">Welcome back.</h1>
              <p className="text-body-ui text-ink-secondary">
                {providers.length ? "Sign in with your email and password, or a linked account." : "Sign in with your email and password."}
                {accountCreationEnabled ? " New here? Create an account in seconds." : null}
              </p>
            </div>
            <Suspense fallback={<p className="text-body-ui text-ink-muted">Loading sign in…</p>}>
              <LoginForm accountCreationEnabled={accountCreationEnabled} providers={providers} />
            </Suspense>
          </div>
        </main>
      </div>

      {/* Brand panel: the stacked lockup, the accent phrase and a few real product objects. */}
      <aside aria-hidden className="relative hidden overflow-hidden p-4 md:block">
        <div className="relative flex h-full flex-col justify-between gap-10 overflow-hidden rounded-[16px] bg-surface p-12">
          <SpaceWorksLogo variant="lockup-stacked" height={72} className="self-start" />
          <div className="relative flex flex-col gap-4 py-6">
            <span className="absolute -right-16 -top-10 size-44 rounded-full bg-sw-citron" />
            <span className="absolute -bottom-2 right-20 size-20 rounded-[16px] bg-sw-sky" />
            <SampleCard name="Shaan Shoukath" plan="Systems Engineer · SpaceWorks" number="SW-2026-0001" until="31 Mar 2027" className="relative -rotate-2" />
            <SampleRow title="Abhiram NJ renewed for 2026-27" meta="₹1,200 · UPI · Receipt SW/26-27/0002" className="relative ml-12 max-w-[340px] rotate-1" />
            <span className="relative ml-4 inline-flex items-center gap-2 self-start rounded-full bg-sw-citron px-4 py-2 text-label text-sw-ink">
              <Check className="size-4" />
              Midlaj C approved
            </span>
          </div>
          <p className="relative flex items-end justify-between gap-6">
            <span className="font-accent text-[34px] font-medium leading-[1.1] text-ink">Members,<br />sorted.</span>
            <span className="size-14 shrink-0 rounded-tl-full bg-highlight" />
          </p>
        </div>
      </aside>
    </div>
  );
}
