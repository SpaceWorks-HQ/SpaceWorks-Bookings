import { isOrganisationApplicationsEnabled } from "@/lib/instanceSettings";
import { OrganisationStatus, type Prisma } from "@prisma/client";
import { requireSuperAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/db";

type Props = {
  searchParams: Promise<{ q?: string; page?: string; status?: string }>;
};

const STATUSES = Object.values(OrganisationStatus);

function parseStatus(value: string | undefined): OrganisationStatus | null {
  return value && (STATUSES as string[]).includes(value) ? (value as OrganisationStatus) : null;
}

export async function loadSuperAdminOrgsView({ searchParams }: Props) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status = parseStatus(sp.status);
  const page = Math.max(0, Number.parseInt(sp.page ?? "0", 10) || 0);
  const take = 50;
  const where: Prisma.OrganisationWhereInput = {
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: q, mode: "insensitive" } }, { contactEmail: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [orgs, counts] = await Promise.all([
    prisma.organisation.findMany({
      where,
      // Waiting applications: oldest first so nothing sits at the bottom of the queue.
      orderBy: status === "PENDING_REVIEW" ? { updatedAt: "asc" } : { createdAt: "desc" },
      take,
      skip: page * take,
      select: { id: true, name: true, slug: true, status: true, source: true, kind: true, city: true, createdAt: true, updatedAt: true, _count: { select: { teamMembers: true } } },
    }),
    prisma.organisation.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const countFor = (value: OrganisationStatus) => counts.find((row) => row.status === value)?._count._all ?? 0;
  const total = counts.reduce((sum, row) => sum + row._count._all, 0);
  const applicationsOpen = await isOrganisationApplicationsEnabled();
  return { applicationsOpen, q, status, page, orgs, total, counts: STATUSES.map((value) => ({ status: value, count: countFor(value) })) };
}
