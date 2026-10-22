import { TERM_STATUS_LABELS, TERM_STATUS_TONES, type TermStatus } from "@/lib/membership/lifecycle";
import { Chip } from "@/components/ui/display";

/** A membership's standing as a word, never colour alone. */
export function TermStatusChip({ status, size = "sm", prefix }: { status: TermStatus | "NONE"; size?: "sm" | "md"; prefix?: string }) {
  return (
    <Chip size={size} tone={TERM_STATUS_TONES[status]}>
      {prefix ? `${prefix} · ` : ""}
      {TERM_STATUS_LABELS[status]}
    </Chip>
  );
}
