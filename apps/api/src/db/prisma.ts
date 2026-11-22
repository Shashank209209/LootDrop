import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as typeof globalThis & {
  lootDropPrisma?: PrismaClient;
};

export const prisma = globalForPrisma.lootDropPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.lootDropPrisma = prisma;
}
