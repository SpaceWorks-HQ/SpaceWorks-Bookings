import type { OrganisationStatus } from "@prisma/client";
import { Chip, type ChipTone } from "@/components/ui/display";

const STATUS: Record<OrganisationStatus, { label: string; tone: ChipTone }> = {
  PENDING_REVIEW: { label: "Under review", tone: "info" },
  CHANGES_REQUESTED: { label: "Changes requested", tone: "warning" },
  ACTIVE: { label: "Active", tone: "success" },
  REJECTED: { label: "Not approved", tone: "danger" },
  SUSPENDED: { label: "Suspended", tone: "danger" },
  ARCHIVED: { label: "Archived", tone: "neutral" },
};

/** An organisation's lifecycle state, always as a word (never colour alone). */
export function OrganisationStatusChip({ status, size = "sm" }: { status: OrganisationStatus; size?: "sm" | "md" }) {
  const { label, tone } = STATUS[status];
  return <Chip size={size} tone={tone}>{label}</Chip>;
}

export const ORGANISATION_STATUS_LABELS: Record<OrganisationStatus, string> = Object.fromEntries(
  Object.entries(STATUS).map(([status, { label }]) => [status, label]),
) as Record<OrganisationStatus, string>;
