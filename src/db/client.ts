import { PrismaClient } from "@prisma/client";

// Singleton simples: evita múltiplas conexões durante hot-reload em dev.
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma = global.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}
