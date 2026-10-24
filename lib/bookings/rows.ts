import { Prisma, type BookingOccurrence, type RateKind } from "@prisma/client";
import type { Tx } from "./db";

/** Occurrence row helpers shared by the booking services. */

/** Rows grouped into slots (all units of one time), in slot order. */
export function groupSlots<T extends Pick<BookingOccurrence, "slotIndex" | "unit" | "startsAt">>(rows: T[]): T[][] {
  const bySlot = new Map<number, T[]>();
  for (const row of [...rows].sort((a, b) => a.slotIndex - b.slotIndex || a.unit - b.unit)) {
    bySlot.set(row.slotIndex, [...(bySlot.get(row.slotIndex) ?? []), row]);
  }
  return [...bySlot.values()].sort((a, b) => a[0].startsAt.getTime() - b[0].startsAt.getTime() || a[0].slotIndex - b[0].slotIndex);
}

/** Write prices (and rate kinds) to many rows in one statement. */
export async function setRowPrices(tx: Tx, rows: Array<{ id: string; priceMinor: number; rateKind: RateKind }>): Promise<void> {
  if (rows.length === 0) return;
  const values = Prisma.join(rows.map((row) => Prisma.sql`(${row.id}, ${row.priceMinor}::int, ${row.rateKind}::"RateKind")`));
  await tx.$executeRaw`UPDATE "BookingOccurrence" AS o SET "priceMinor" = v.price, "rateKind" = v.kind, "updatedAt" = now()
    FROM (VALUES ${values}) AS v(id, price, kind) WHERE o."id" = v.id`;
}

/** Write units to many rows in one statement (rows must not be blocking while units move). */
export async function setRowUnits(tx: Tx, rows: Array<{ id: string; unit: number }>): Promise<void> {
  if (rows.length === 0) return;
  const values = Prisma.join(rows.map((row) => Prisma.sql`(${row.id}, ${row.unit}::int)`));
  await tx.$executeRaw`UPDATE "BookingOccurrence" AS o SET "unit" = v.unit, "updatedAt" = now() FROM (VALUES ${values}) AS v(id, unit) WHERE o."id" = v.id`;
}
