import type { PrismaClient } from '@prisma/client';
import express from 'express';
import rateLimit from 'express-rate-limit';
import pino from 'pino';
import { expect, it } from 'vitest';
import { createAlertsRouter } from '../alerts/alerts-router.js';
import { createAuthRouter } from '../auth/auth-router.js';
import { envSchema } from '../config/env-schema.js';
import { enrichMetadata } from '../pricing/rawg/enrichment.js';
import { createWishlistRouter } from '../wishlist/wishlist-router.js';
import { requestErrorHandler, requestLogger } from './request-safety.js';

const secret = 'sample-fixture'.repeat(5);
const origin = 'https://web.example.test';
const issuer = 'test';
const database = {} as PrismaClient;

async function withServer(app: express.Express, check: (base: string) => Promise<void>) {
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No local server');
    await check('http://127.0.0.1:' + address.port);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

it('logs only operational data across auth, wishlist, alert and enrichment failures', async () => {
  const chunks: string[] = [];
  const logger = pino(
    {},
    {
      write: (chunk) => {
        chunks.push(chunk);
      },
    },
  );
  const address = ['masked-fixture', 'example.invalid'].join('@');
  const password = 'masked-password-fixture';
  const apiKey = 'masked-upstream-fixture';
  const cookie = 'masked-cookie-fixture';
  const token = 'masked-bearer-fixture';
  const app = express();
  app.use(requestLogger(logger));
  app.use(express.json({ limit: '1kb' }));
  app.use(
    '/auth',
    createAuthRouter(database, {
      accessSecret: secret,
      issuer,
      webOrigin: origin,
      cookieSecure: true,
      cookieSameSite: 'none',
      rateLimitWindowMs: 1000,
      rateLimitMax: 5,
    }),
  );
  app.use('/wishlist', createWishlistRouter(database, secret, issuer));
  app.use(createAlertsRouter(database, secret, issuer));
  app.get('/failed', () => {
    throw new Error(address + ' ' + apiKey);
  });
  app.use(requestErrorHandler(logger));

  const headers = {
    'Content-Type': 'application/json',
    Cookie: 'lootdrop_refresh=' + cookie,
    Authorization: 'Bearer ' + token,
  };
  await withServer(app, async (base) => {
    expect(
      (
        await fetch(base + '/auth/login', {
          method: 'POST',
          headers,
          body: JSON.stringify({ email: address, password }),
        })
      ).status,
    ).toBe(500);
    for (const path of ['/wishlist', '/alerts']) {
      expect((await fetch(base + path + '?key=' + apiKey, { headers })).status).toBe(401);
    }
    const error = await fetch(base + '/failed', { headers });
    expect(await error.json()).toEqual({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
        details: null,
      },
    });
    const malformed = await fetch(base + '/auth/login', {
      method: 'POST',
      headers,
      body: '{"oops":',
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
    const oversized = await fetch(base + '/auth/login', {
      method: 'POST',
      headers,
      body: JSON.stringify({ filler: 'x'.repeat(2048) }),
    });
    expect(oversized.status).toBe(413);
  });
  await enrichMetadata({
    database: {
      game: {
        findMany: async ({ where }: { where: { listings: { some?: unknown } } }) =>
          where.listings.some ? [{ id: 'fixture-game', slug: 'fixture', title: 'Fixture' }] : [],
      },
    } as unknown as PrismaClient,
    adapter: {
      searchGames: async () => {
        throw new Error(address + ' ' + apiKey);
      },
      getGame: async () => {
        throw new Error();
      },
      requestsUsed: 1,
    },
    negativeCache: { find: async () => new Set(), remember: async () => {} },
    logger,
    batchSize: 1,
  });
  const logs = chunks.join('');
  expect(logs).toContain('RAWG metadata enrichment failed');
  expect(logs).toContain('statusCode');
  for (const value of [address, password, apiKey, cookie, token, 'authorization', 'stack']) {
    expect(logs.includes(value)).toBe(false);
  }
});

it.each([0, 1])('trusts client forwarding only with %s configured proxy hops', async (hops) => {
  const parsed = envSchema.parse({
    DATABASE_URL: 'postgresql://localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: secret,
    TRUST_PROXY: String(hops),
  }).TRUST_PROXY;
  const app = express();
  app.set('trust proxy', parsed || false);
  app.use(rateLimit({ limit: 1, windowMs: 1000, validate: { xForwardedForHeader: false } }));
  app.get('/', (_request, response) => response.sendStatus(200));
  await withServer(app, async (base) => {
    expect((await fetch(base, { headers: { 'X-Forwarded-For': '192.0.2.1' } })).status).toBe(200);
    expect((await fetch(base, { headers: { 'X-Forwarded-For': '192.0.2.2' } })).status).toBe(
      hops ? 200 : 429,
    );
  });
});
