import Link from "next/link";
import type { Metadata } from "next";
import { loadMakerspaceApplicationView } from "@/lib/views/app__dashboard__makerspaceSlug__application__page";
import { STATUS_EXPLANATIONS } from "@/lib/makerspaceLifecycle";
import { Patch } from "@/components/brand/Patch";
import { indianStateName } from "@/lib/indianStates";
import { MakerspaceStatusChip } from "@/components/makerspace/MakerspaceStatusChip";
import { ReviewHistory } from "@/components/super-admin/ReviewHistory";
import { ResubmitApplicationForm } from "@/components/onboarding/ResubmitApplicationForm";
import { buttonClasses } from "@/components/ui/button";
import { Callout, Card, CardHeader, DetailList, PageHeader, type CalloutTone } from "@/components/ui/display";

export const metadata: Metadata = { title: "Application", robots: { index: false, follow: false } };

const TONES: Record<string, CalloutTone> = {
  PENDING_REVIEW: "info",
  CHANGES_REQUESTED: "warning",
  ACTIVE: "success",
  REJECTED: "danger",
  SUSPENDED: "danger",
  ARCHIVED: "info",
};

export default async function MakerspaceApplicationPage({ params }: { params: Promise<{ makerspaceSlug: string }> }) {
  const { makerspace, reviews, latestNote, canEdit, isManager } = await loadMakerspaceApplicationView({ params });
  const explanation = STATUS_EXPLANATIONS[makerspace.status];
  const showNote = latestNote && makerspace.status !== "ACTIVE";
  return (
    <div className="flex max-w-[860px] flex-col gap-6">
      <PageHeader
        kicker={<MakerspaceStatusChip status={makerspace.status} size="md" />}
        title={makerspace.status === "ACTIVE" ? "Makerspace status" : "Your application"}
        description={`${makerspace.name} · applied ${makerspace.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`}
      />

      {/* Approval is the platform letting a new pack in, so Patch sneezes its vote once. */}
      <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center">
        {makerspace.status === "ACTIVE" ? <Patch pose="sneeze" size={96} className="-my-3 -ml-3" /> : null}
        <Callout
          tone={TONES[makerspace.status]}
          title={explanation.title}
          role="status"
          className="w-full min-w-0 flex-1"
          action={makerspace.status === "ACTIVE" ? <Link href={`/dashboard/${makerspace.slug}`} className={buttonClasses({ variant: "secondary", size: "sm" })}>Open dashboard</Link> : undefined}
        >
          {explanation.body}
        </Callout>
      </div>

      {showNote ? (
        <Card as="section" className="rounded-xl">
          <CardHeader title="Note from the platform team" />
          <p className="whitespace-pre-wrap text-body-ui text-ink">{latestNote}</p>
        </Card>
      ) : null}

      <div className={canEdit ? "flex flex-col gap-6" : "grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]"}>
        <Card as="section" className="rounded-xl">
          {canEdit ? (
            <>
              <CardHeader title="Update your application" description="Change what the note asks for, then send it again. The platform team is told straight away." />
              <ResubmitApplicationForm
                makerspaceSlug={makerspace.slug}
                initial={{
                  name: makerspace.name,
                  kind: makerspace.kind,
                  description: makerspace.description,
                  contactEmail: makerspace.contactEmail ?? "",
                  contactPhone: makerspace.contactPhone ?? "",
                  website: makerspace.website ?? "",
                  addressLine: makerspace.addressLine ?? "",
                  city: makerspace.city ?? "",
                  stateCode: makerspace.stateCode ?? "",
                  postalCode: makerspace.postalCode ?? "",
                }}
              />
            </>
          ) : (
            <>
              <CardHeader
                title="What you told us"
                description={makerspace.status === "CHANGES_REQUESTED" && !isManager ? "An owner or manager can update the application." : undefined}
              />
              <DetailList
                items={[
                  { label: "Name", value: makerspace.name },
                  { label: "Web address", value: `/m/${makerspace.slug}` },
                  { label: "Kind", value: makerspace.kind || "Not given" },
                  { label: "Description", value: <span className="whitespace-pre-wrap">{makerspace.description || "Not given"}</span> },
                  { label: "Email", value: makerspace.contactEmail ?? "Not given" },
                  { label: "Phone", value: makerspace.contactPhone ?? "Not given" },
                  { label: "Website", value: makerspace.website ?? "Not given" },
                  { label: "Address", value: [makerspace.addressLine, makerspace.city, indianStateName(makerspace.stateCode), makerspace.postalCode].filter(Boolean).join(", ") || "Not given" },
                ]}
              />
            </>
          )}
        </Card>
        <Card as="section" className="h-fit rounded-xl">
          <CardHeader title="History" titleAs="h2" />
          <ReviewHistory reviews={reviews} showActor={false} />
        </Card>
      </div>
    </div>
  );
}
