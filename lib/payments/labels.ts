import type { ChipTone } from "@/components/ui/display";

/** Words for payment states and providers. Client-safe. */

export type PaymentStatusName = "PENDING" | "AWAITING_CONFIRMATION" | "PAID" | "WAIVED" | "FAILED" | "CANCELLED";

export const PAYMENT_STATUS_LABELS: Record<PaymentStatusName, string> = {
  PENDING: "Started",
  AWAITING_CONFIRMATION: "To confirm",
  PAID: "Paid",
  WAIVED: "Waived",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export const PAYMENT_STATUS_TONES: Record<PaymentStatusName, ChipTone> = {
  PENDING: "neutral",
  AWAITING_CONFIRMATION: "warning",
  PAID: "success",
  WAIVED: "info",
  FAILED: "danger",
  CANCELLED: "outline",
};

export const PROVIDER_LABELS = { RAZORPAY: "Razorpay", STRIPE: "Stripe", OFFLINE: "Offline" } as const;

export const REFUND_STATUS_LABELS = { PENDING: "Refund pending", PROCESSED: "Refunded", FAILED: "Refund failed" } as const;

export function methodLabel(method: string | null | undefined) {
  if (!method) return null;
  const known: Record<string, string> = { upi: "UPI", card: "Card", netbanking: "Netbanking", wallet: "Wallet", emi: "EMI", cash: "Cash", bank_transfer: "Bank transfer", cheque: "Cheque", card_terminal: "Card machine", waiver: "Waiver", other: "Other" };
  return known[method] ?? method.replace(/_/g, " ");
}

/** Directory filters on the payments page, in tab order. */
export const PAYMENT_FILTERS = ["all", "confirm", "flagged", "paid", "open", "refunds", "failed"] as const;
export type PaymentFilter = (typeof PAYMENT_FILTERS)[number];

export const PAYMENT_FILTER_LABELS: Record<PaymentFilter, string> = {
  all: "All",
  confirm: "To confirm",
  flagged: "Needs review",
  paid: "Paid",
  open: "Started",
  refunds: "Refunds",
  failed: "Failed or cancelled",
};
