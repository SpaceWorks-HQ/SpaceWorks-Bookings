import { Chip } from "@/components/ui/display";
import { PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONES, type PaymentStatusName } from "@/lib/payments/labels";

/** A payment's state as a word, never colour alone. */
export function PaymentStatusChip({ status, flagged, size = "sm" }: { status: PaymentStatusName; flagged?: boolean; size?: "sm" | "md" }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Chip size={size} tone={PAYMENT_STATUS_TONES[status]}>{PAYMENT_STATUS_LABELS[status]}</Chip>
      {flagged ? <Chip size={size} tone="danger">Needs review</Chip> : null}
    </span>
  );
}
