import Link from "next/link";
import { ArrowUpRight, CalendarCheck } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { DeployTabs } from "@/components/marketing/DeployTabs";
import { FAQ, FEATURES, GITHUB } from "@/components/marketing/landingData";
import { SectionHeading } from "@/components/marketing/SectionHeading";
import "@/components/marketing/landing.css";

/** A sample booking for the hero (product proof, not live data). */
function SampleBooking() {
  return (
    <div className="landing-fade flex w-full max-w-[420px] flex-col gap-4 justify-self-center rounded-2xl bg-primary p-6 text-on-primary" style={{ ["--rise-delay" as string]: "360ms" }}>
      <span className="flex items-center justify-between gap-3">
        <span className="text-overline">Booking BK-7Q2M4X</span>
        <span className="rounded-full bg-sw-citron px-2.5 py-0.5 text-caption font-semibold text-sw-ink">Confirmed</span>
      </span>
      <span className="flex items-center gap-3">
        <CalendarCheck aria-hidden className="size-8 shrink-0" />
        <span className="flex flex-col">
          <span className="text-h3 text-on-primary">Laser studio</span>
          <span className="text-caption opacity-90">Friday, 14:00 to 16:00 · 4 people</span>
        </span>
      </span>
      <span className="flex items-end justify-between gap-3 text-caption">
        <span className="tabular-nums">₹1,180 paid by UPI</span>
        <span>Receipt SW/26-27/0042</span>
      </span>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="flex flex-col">
      {/* Hero: the offer on the left, a booking on the right. */}
      <section aria-labelledby="hero-title" className="landing-boxes landing-hero flex flex-col overflow-hidden border-b border-line">
        <div className="mx-auto grid w-full max-w-[1160px] flex-1 items-center gap-12 px-4 pb-14 pt-12 sm:px-6 md:pt-16 lg:grid-cols-[minmax(0,1fr)_460px] lg:gap-10 lg:pt-10">
          <div className="flex max-w-[600px] flex-col gap-6">
            <h1 id="hero-title" className="text-display-l text-ink">
              <span className="landing-line"><span>Your spaces.</span></span>
              <span className="landing-line"><span style={{ ["--rise-delay" as string]: "120ms" }}>Booked, paid, sorted.</span></span>
            </h1>
            <p className="landing-fade text-body-l text-ink-secondary" style={{ ["--rise-delay" as string]: "300ms" }}>
              Rooms, studios, desks and halls for makerspaces: availability, approvals, payments, GST receipts and refunds.
              Apply to run your makerspace here, or host it yourself.
            </p>
            <div className="landing-fade flex flex-wrap items-center gap-x-6 gap-y-3" style={{ ["--rise-delay" as string]: "420ms" }}>
              <Link href="/start" className={buttonClasses({ variant: "highlight", size: "lg" })}>
                Apply for your makerspace
                <ArrowUpRight aria-hidden className="size-4" />
              </Link>
              <Link href="#self-host" className="inline-flex min-h-11 items-center gap-1.5 rounded-control text-label font-semibold text-ink underline-offset-4 hover:underline">
                Run it yourself
                <ArrowUpRight aria-hidden className="size-4" />
              </Link>
            </div>
            <p className="landing-fade text-caption text-ink-muted" style={{ ["--rise-delay" as string]: "520ms" }}>Free and open source. Self-hosted. In active development.</p>
          </div>
          <SampleBooking />
        </div>
      </section>

      {/* What it does. */}
      <section aria-labelledby="features" className="bg-canvas">
        <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-10 px-4 py-20 sm:px-6 lg:py-28">
          <SectionHeading id="features" title={<>Every booking,<br />start to finish.</>} />
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {FEATURES.map((feature) => (
              <li key={feature.title} className="sr-up flex flex-col gap-2 rounded-2xl border border-line bg-panel p-6">
                <h3 className="text-h4 text-ink">{feature.title}</h3>
                <p className="text-body-ui text-ink-secondary">{feature.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Self-hosting. */}
      <section aria-labelledby="self-host" className="scroll-mt-20 bg-sw-teal text-sw-cream">
        <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-12 px-4 py-20 sm:px-6 lg:py-28">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <SectionHeading id="self-host" inverse title={<>Your server.<br />Your bookings.</>}>
              The whole platform is open source. Run it for one makerspace, or for every makerspace in your network, the way that suits you.
            </SectionHeading>
            <a href={GITHUB} className="sr-fade inline-flex min-h-11 w-fit shrink-0 items-center gap-1.5 rounded-control text-label font-semibold underline-offset-4 hover:underline">
              View on GitHub
              <ArrowUpRight aria-hidden className="size-4" />
            </a>
          </div>
          <div className="sr-right">
            <DeployTabs />
          </div>
        </div>
      </section>

      {/* Questions. */}
      <section aria-labelledby="questions" className="bg-canvas">
        <div className="mx-auto grid w-full max-w-[1160px] gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:py-28">
          <SectionHeading id="questions" title={<>Questions<br />makerspaces ask.</>} />
          <div className="flex flex-col border-t border-line">
            {FAQ.map((item) => (
              <details key={item.q} className="group border-b border-line">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-h4 text-ink marker:hidden [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span aria-hidden className="relative size-4 shrink-0">
                    <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-ink" />
                    <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-ink transition-transform duration-200 ease-sw group-open:scale-y-0" />
                  </span>
                </summary>
                <p className="max-w-[60ch] pb-5 text-body-ui text-ink-secondary">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Close. */}
      <section aria-labelledby="close" className="landing-boxes overflow-hidden border-t border-line">
        <div className="mx-auto flex w-full max-w-[1160px] flex-col items-start gap-6 px-4 py-20 sm:px-6 lg:py-28">
          <h2 id="close" className="sr-rise text-display-l text-balance text-ink">
            Open your spaces
            <br />
            for booking.
          </h2>
          <p className="max-w-[56ch] text-body-l text-ink-secondary">
            Tell us about your makerspace. Once it is approved, add your spaces and share your booking link.
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link href="/start" className={buttonClasses({ variant: "highlight", size: "lg" })}>
              Apply for your makerspace
              <ArrowUpRight aria-hidden className="size-4" />
            </Link>
            <Link href="/login" className="inline-flex min-h-11 items-center rounded-control text-label font-semibold text-ink underline-offset-4 hover:underline">
              Sign in
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
