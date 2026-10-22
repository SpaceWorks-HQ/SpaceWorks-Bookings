import { MemberPaymentsPanel } from "@/components/payments/MemberPaymentsPanel";
import { money } from "@/lib/membership/describe";
import { formatCalendarDate, localDate } from "@/lib/membership/periods";
import { methodLabel, PROVIDER_LABELS } from "@/lib/payments/labels";
import type { loadMemberPayments } from "@/lib/views/app__dashboard__orgSlug__members__memberId__payments";

type Data = NonNullable<Awaited<ReturnType<typeof loadMemberPayments>>>;

/** Formats the member's payments for the client panel. */
export function MemberPaymentsSection({ data }: { data: Data }) {
  const { org } = data;
  const day = (date: Date) => formatCalendarDate(localDate(date, org.timezone));
  return (
    <MemberPaymentsPanel
      slug={org.slug}
      canManage={data.canManage}
      makerChecker={org.offlineConfirmationRequired}
      due={data.due.map((item) => ({ termId: item.termId, planName: item.planName, amount: money(item.amountMinor, item.currency, org.locale), awaiting: item.awaiting }))}
      payments={data.payments.map((payment) => {
        const refunded = payment.refunds.filter((refund) => refund.status === "PROCESSED").reduce((sum, refund) => sum + refund.amountMinor, 0);
        return {
          id: payment.id,
          status: payment.status,
          flagged: Boolean(payment.flaggedAt),
          amount: `${money(payment.amountMinor, payment.currency, org.locale)}${refunded ? ` (${money(refunded, payment.currency, org.locale)} refunded)` : ""}`,
          label: [payment.term?.plan.name, payment.provider === "OFFLINE" ? methodLabel(payment.method) : PROVIDER_LABELS[payment.provider]].filter(Boolean).join(" · "),
          when: day(payment.paidAt ?? payment.createdAt),
          documents: payment.documents,
        };
      })}
    />
  );
}
