import { requireOrgTeam } from "@/lib/permissions";

export async function loadOrgSlugShell({
  params,
}: {

  params: Promise<{ orgSlug: string; }>;
}) {
  const { orgSlug } = await params;
  // Any status: the application page lives under this layout. Each page applies its own gate.
  const { organisation } = await requireOrgTeam(orgSlug);
  return { organisation };
}
