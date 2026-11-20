import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import pino from 'pino';
import { env } from '../config/env.js';
import { enrichmentDisabledMessage, runEnrichment } from '../pricing/rawg/run-enrichment.js';

async function main() {
  let options;
  try {
    options = parseArgs({
      options: { limit: { type: 'string' }, 'allow-production': { type: 'boolean' } },
    }).values;
  } catch {
    console.error('Usage: npm run enrich:once -- --limit <positive integer> [--allow-production]');
    process.exitCode = 1;
    return;
  }
  const limit = options.limit === undefined ? undefined : Number(options.limit);
  if (
    limit !== undefined &&
    (!Number.isSafeInteger(limit) || limit < 1 || !/^\d+$/.test(options.limit ?? ''))
  ) {
    console.error('--limit must be a positive integer');
    process.exitCode = 1;
    return;
  }
  if (!env.RAWG_API_KEY) {
    console.warn(enrichmentDisabledMessage);
    return;
  }

  const target = process.env.PHASE5_GUARD_TARGET;
  const fingerprint = createHash('sha256')
    .update(env.DATABASE_URL)
    .update('\0')
    .update(process.env.DIRECT_URL ?? '')
    .digest('hex');
  if (
    fingerprint !== process.env.PHASE5_GUARD_FINGERPRINT ||
    (target !== 'phase-5-test' && !(target === 'production' && options['allow-production']))
  ) {
    console.error('Enrichment requires a confirmed target from the Phase 5 guard');
    process.exitCode = 1;
    return;
  }

  const { redis } = await import('../db/redis.js');
  const { prisma } = await import('../db/prisma.js');
  try {
    const result = await runEnrichment(prisma, redis, pino({ level: env.LOG_LEVEL }), limit);
    console.log(JSON.stringify(result));
  } finally {
    await prisma.$disconnect();
    redis.disconnect();
  }
}

main().catch(() => {
  console.error('Metadata enrichment could not complete');
  process.exitCode = 1;
});
