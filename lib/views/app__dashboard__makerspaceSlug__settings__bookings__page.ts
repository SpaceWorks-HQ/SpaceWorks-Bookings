import { prisma } from "@/lib/db";
import { requireMakerspaceCapability } from "@/lib/permissions";
import { pickRules } from "@/lib/bookingRules/schema";
import { effectiveRules } from "@/lib/bookingRules/effective";
import { allowed, makerspaceSummary, type RouteProps } from "@/lib/bookings/staffView";

export async function loadBookingSettings({ params }: RouteProps) {
  const { makerspaceSlug } = await params;
  const access = await requireMakerspaceCapability(makerspaceSlug, "makerspace.settings");
  const defaults = pickRules(await prisma.makerspaceBookingSettings.findUnique({ where: { makerspaceId: access.makerspace.id } }));
  return { makerspace: await makerspaceSummary(access.makerspace.id), defaults, rules: effectiveRules(defaults), canMoney: allowed(access, "payments.settings") };
}
