import { requireMakerspaceCapability } from "@/lib/permissions";
import { allowed, makerspaceSummary, type RouteProps } from "@/lib/bookings/staffView";

export async function loadNewSpace({ params }: RouteProps) {
  const { makerspaceSlug } = await params;
  const access = await requireMakerspaceCapability(makerspaceSlug, "spaces.manage");
  return { makerspace: await makerspaceSummary(access.makerspace.id), canMoney: allowed(access, "payments.settings") };
}
