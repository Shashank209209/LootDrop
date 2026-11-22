import { app, ratesRedis } from './app.js';
import { env } from './config/env.js';
import { enrichmentDisabledMessage } from './pricing/rawg/run-enrichment.js';
import { prisma } from './db/prisma.js';
import { handleShutdown } from './shutdown.js';

if (!env.RAWG_API_KEY) console.warn(enrichmentDisabledMessage);
const server = app.listen(env.API_PORT, () => {
  console.info(`LootDrop API listening on http://localhost:${env.API_PORT}`);
});
handleShutdown(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  ratesRedis.disconnect();
  await prisma.$disconnect();
});
