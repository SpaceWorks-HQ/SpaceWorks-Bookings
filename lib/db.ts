import "./env";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

/**
 * After `prisma migrate` / `prisma generate`, dev HMR can keep a cached PrismaClient
 * from before new models existed — their delegates are then missing.
 * Replace stale singletons so every current delegate always exists.
 */
function getPrisma(): PrismaClient {
  const existing = globalForPrisma.prisma;
  const delegates = existing as unknown as {
    teamMember?: { findMany: unknown };
    makerspaceReview?: { findMany: unknown };
  } | undefined;
  const delegateOk = Boolean(
    delegates &&
      typeof delegates.teamMember?.findMany === "function" &&
      typeof delegates.makerspaceReview?.findMany === "function",
  );

  if (delegateOk && existing) {
    return existing;
  }

  if (existing) {
    void existing.$disconnect();
  }

  const client = createPrismaClient();
  globalForPrisma.prisma = client;
  return client;
}

export const prisma = getPrisma();
