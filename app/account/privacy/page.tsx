import Link from "next/link";
import type { Metadata } from "next";
import { Download } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardHeader, SectionHeading } from "@/components/ui/display";

export const metadata: Metadata = { title: "Privacy and your data" };

export default function AccountPrivacyPage() {
  return (
    <div className="flex flex-col gap-6">
      <SectionHeading title="Privacy and your data" description="Take a copy of what this platform holds about your account." />
      <Card as="section" className="rounded-xl">
        <CardHeader
          titleAs="h3"
          title="Download your data"
          description="Your profile and your team roles in every organisation. Up to 5 downloads an hour."
        />
        <div className="flex flex-wrap gap-2">
          {/* A plain link: this is a file download, not a page navigation. */}
          <a href="/api/exports/account" download className={buttonClasses({ variant: "primary", size: "sm" })}>
            <Download aria-hidden className="size-4" />
            Download your data (JSON)
          </a>
        </div>
      </Card>
      <p className="text-caption text-ink-muted">
        How we handle personal data is in the <Link href="/privacy" className="underline underline-offset-4">privacy notice</Link>.
      </p>
    </div>
  );
}
