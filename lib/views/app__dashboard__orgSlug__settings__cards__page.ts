import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { can, requireOrgCapability } from "@/lib/permissions";
import { memberWhere, teamScope } from "@/lib/membership/scope";
import { deriveCardPrefix } from "@/lib/cards/core";
import { brandingFor, designFor, loadCardOrgContext } from "@/lib/cards/data";
import { normalizeCardDesign } from "@/lib/cards/design/presets";

/** The card designer for the organisation default or one plan, and the requester's recent bulk exports. */
export async function loadOrgCardSettingsView({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ plan?: string }> }) {
  const { orgSlug } = await params;
  const { plan: planParam } = await searchParams;
  const { organisation, membership, userId } = await requireOrgCapability(orgSlug, "org.settings");
  const ctx = await loadCardOrgContext(organisation.id);
  if (!ctx) notFound();
  const [plans, exports, cardCount] = await Promise.all([
    prisma.membershipPlan.findMany({ where: { organisationId: organisation.id, archivedAt: null }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    prisma.cardExportJob.findMany({
      where: { organisationId: organisation.id, requestedById: userId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, format: true, status: true, cardCount: true, byteSize: true, error: true, createdAt: true, finishedAt: true, expiresAt: true, storageKey: true },
    }),
    prisma.memberCard.count({ where: { organisationId: organisation.id, revokedAt: null, member: memberWhere(await teamScope(organisation.id, membership.unitId)) } }),
  ]);
  const plan = planParam ? plans.find((item) => item.id === planParam) ?? null : null;
  if (planParam && !plan) notFound();

  const orgRow = ctx.designs.find((row) => row.planId === null);
  const editing = plan
    ? designFor(ctx, plan)
    : { design: normalizeCardDesign(orgRow?.design, { organisationName: ctx.organisation.name, planName: "" }), branding: brandingFor(ctx, orgRow?.watermarkUrl ?? null), source: orgRow ? "organisation" as const : "default" as const };
  // A plan's own questions, or every plan's for the organisation default (one entry per key).
  const fields = new Map<string, { key: string; label: string }>();
  for (const field of plan ? ctx.fields.get(plan.id) ?? [] : [...ctx.fields.values()].flat()) {
    if (!fields.has(field.key)) fields.set(field.key, { key: field.key, label: field.label });
  }

  return {
    org: { name: ctx.organisation.name, slug: ctx.organisation.slug, logoUrl: ctx.organisation.logoUrl },
    plans: plans.map((item) => ({ ...item, ownDesign: ctx.designs.some((row) => row.planId === item.id) })),
    plan,
    design: editing.design,
    branding: editing.branding,
    source: editing.source,
    fields: [...fields.values()],
    numberPrefix: orgRow?.numberPrefix ?? deriveCardPrefix(ctx.organisation.name),
    cardCount,
    exports: exports.map(({ storageKey, ...job }) => ({ ...job, downloadable: job.status === "DONE" && Boolean(storageKey) && (!job.expiresAt || job.expiresAt > new Date()) })),
    canEdit: !membership.unitId,
    canExport: can(membership.role, "cards.manage"),
  };
}
