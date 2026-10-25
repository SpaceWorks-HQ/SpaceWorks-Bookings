import { requireMakerspaceCapability } from "@/lib/permissions";
import { calendarData, makerspaceSummary, type RouteProps } from "@/lib/bookings/staffView";

export async function loadHoursSettings({ params }: RouteProps) {
  const { makerspaceSlug } = await params;
  const { makerspace } = await requireMakerspaceCapability(makerspaceSlug, "makerspace.settings");
  return { makerspace: await makerspaceSummary(makerspace.id), calendar: await calendarData(makerspace.id, null) };
}
