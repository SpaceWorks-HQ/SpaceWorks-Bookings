import { requireMakerspaceTeam } from "@/lib/permissions";

export async function loadMakerspaceSlugShell({
  params,
}: {

  params: Promise<{ makerspaceSlug: string; }>;
}) {
  const { makerspaceSlug } = await params;
  // Any status: the application page lives under this layout. Each page applies its own gate.
  const { makerspace } = await requireMakerspaceTeam(makerspaceSlug);
  return { makerspace };
}
