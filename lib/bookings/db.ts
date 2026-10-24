import { Prisma, type Booking, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { notFound } from "./errors";

/**
 * Transactions and locks for the booking services. Lock order everywhere: Booking → its Payments (by id) → Refunds
 * → DocumentCounter. Inserting or moving blocking occurrences also takes the space's advisory lock, after any
 * booking row lock. There is no Space row lock.
 */

export type Tx = Prisma.TransactionClient;
export type DbOrTx = PrismaClient | Tx;

const TX_OPTIONS = { maxWait: 20_000, timeout: 60_000 };

/** Run in the caller's transaction, or open one. */
export async function withTx<T>(db: DbOrTx, work: (tx: Tx) => Promise<T>): Promise<T> {
  if ("$transaction" in db && typeof db.$transaction === "function") return (db as PrismaClient).$transaction(work, TX_OPTIONS);
  return work(db as Tx);
}

export function defaultDb(): PrismaClient {
  return prisma;
}

/** Lock one booking of a makerspace (FOR UPDATE) and read it. Another makerspace's booking is not found. */
export async function lockBooking(tx: Tx, makerspaceId: string, bookingId: string): Promise<Booking> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Booking" WHERE "id" = ${bookingId} AND "makerspaceId" = ${makerspaceId} FOR UPDATE`;
  if (rows.length === 0) throw notFound();
  return tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
}

/** Serialise inserts and moves of blocking occurrences in one space (taken after any booking lock). */
export async function lockSpaces(tx: Tx, spaceIds: string[]): Promise<void> {
  for (const spaceId of [...new Set(spaceIds)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`space:${spaceId}`}))`;
  }
}
