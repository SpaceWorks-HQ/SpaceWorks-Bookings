import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { canDeleteOrg, requireOrgRole } from "@/lib/permissions";
type Props = { params: Promise<{ orgSlug: string; }>; };

export async function loadOrgSettingsView({ params }: Props) {

  const { orgSlug } = await params;
  const { organisation, membership } = await requireOrgRole(orgSlug, "ADMIN");

  const org = await prisma.organisation.findUnique({
    where: { id: organisation.id },
    select: { name: true, description: true, logoUrl: true, slug: true },
  });

  if (!org) notFound();

  const canDelete = canDeleteOrg(membership);
  return { org, organisation, membership, canDelete };
}
