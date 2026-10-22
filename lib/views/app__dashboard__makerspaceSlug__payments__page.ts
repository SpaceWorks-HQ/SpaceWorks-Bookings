import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { can, requireMakerspaceCapability } from "@/lib/permissions";
import { PAYMENT_FILTERS, type PaymentFilter } from "@/lib/payments/labels";

const PAGE_SIZE = 50;

function filterWhere(filter: PaymentFilter): Prisma.PaymentWhereInput {
  switch (filter) {
    case "confirm": return { status: "AWAITING_CONFIRMATION" };
    case "flagged": return { OR: [{ flaggedAt: { not: null } }, { documentHeld: true }] };
    case "paid": return { status: { in: ["PAID", "WAIVED"] } };
    case "open": return { status: "PENDING" };
    case "refunds": return { refunds: { some: {} } };
    case "failed": return { status: { in: ["FAILED", "CANCELLED"] } };
    default: return {};
  }
}

/** Every payment the person may see, with queue counts, search and paging. */
export async function loadPaymentsDirectory({ params, searchParams }: { params: Promise<{ makerspaceSlug: string }>; searchParams: Promise<{ status?: string; q?: string; page?: string }> }) {
  const { makerspaceSlug } = await params;
  const search = await searchParams;
  const { makerspace: current, membership } = await requireMakerspaceCapability(makerspaceSlug, "payments.view");
  const filter = (PAYMENT_FILTERS as readonly string[]).includes(search.status ?? "") ? (search.status as PaymentFilter) : "all";
  const q = (search.q ?? "").trim().slice(0, 80);
  const page = Math.max(1, Math.min(1000, Number.parseInt(search.page ?? "1", 10) || 1));
  const base: Prisma.PaymentWhereInput = {
    makerspaceId: current.id,
    ...(q
      ? {
          OR: [
            { customerName: { contains: q, mode: "insensitive" } },
            { customerEmail: { contains: q, mode: "insensitive" } },
            { utr: { contains: q.toUpperCase() } },
            { gatewayPaymentId: q },
            { documents: { some: { number: { contains: q.toUpperCase() } } } },
          ],
        }
      : {}),
  };
  const where: Prisma.PaymentWhereInput = { AND: [base, filterWhere(filter)] };
  const [makerspace, counts, total, payments, settings, stuckRefunds] = await Promise.all([
    prisma.makerspace.findUniqueOrThrow({ where: { id: current.id }, select: { name: true, slug: true, logoUrl: true, status: true, locale: true, timezone: true, offlineConfirmationRequired: true } }),
    Promise.all(PAYMENT_FILTERS.map((key) => prisma.payment.count({ where: { AND: [base, filterWhere(key)] } }))),
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, status: true, provider: true, method: true, currency: true, amountMinor: true, createdAt: true, paidAt: true, flaggedAt: true, documentHeld: true, utr: true, recordedById: true,
        customerName: true, customerEmail: true, bookingId: true,
        documents: { where: { kind: { not: "CREDIT_NOTE" } }, select: { id: true, number: true } },
        refunds: { select: { amountMinor: true, status: true } },
      },
    }),
    prisma.makerspacePaymentSettings.findUnique({ where: { makerspaceId: current.id }, select: { provider: true, testMode: true } }),
    prisma.refund.count({ where: { makerspaceId: current.id, status: "PENDING", createdAt: { lt: new Date(Date.now() - 86_400_000) } } }),
  ]);
  return {
    makerspace,
    filter,
    q,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    total,
    counts: Object.fromEntries(PAYMENT_FILTERS.map((key, index) => [key, counts[index]])) as Record<PaymentFilter, number>,
    payments,
    gateway: settings && settings.provider !== "NONE" ? settings : null,
    stuckRefunds,
    canManage: can(membership.role, "payments.manage"),
    canConfigure: can(membership.role, "payments.settings"),
    userId: membership.userId,
  };
}
