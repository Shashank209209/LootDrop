import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as typeof globalThis & {
  dealHunterPrisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.dealHunterPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.dealHunterPrisma = prisma;
}
