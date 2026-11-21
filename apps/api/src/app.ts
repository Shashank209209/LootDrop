import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import pino from 'pino';
import { Redis } from 'ioredis';
import { env } from './config/env.js';
import { prisma } from './db/prisma.js';
import { createDealsRouter } from './pricing/deals-router.js';
import { createGamesRouter } from './games/games-router.js';
import { createTaxonomyRouter } from './games/taxonomy-router.js';
import { createCuratedDealsRouter } from './pricing/curated-deals-router.js';
import { createOpenApiDocument } from './openapi.js';
import { createAuthRouter } from './auth/auth-router.js';
import { createWishlistRouter } from './wishlist/wishlist-router.js';
import { createAlertsRouter } from './alerts/alerts-router.js';
import { createNotificationsRouter } from './alerts/notifications-router.js';
import { createCurrencyRouter } from './currency/currency-router.js';
import { RatesService } from './currency/rates-service.js';
import { RedisJsonCache } from './pricing/cache.js';
import { requestLogger, requestErrorHandler } from './http/request-safety.js';
import { readiness } from './http/readiness.js';

const logger = pino({ level: env.LOG_LEVEL });
const app = express();
const ratesRedis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  commandTimeout: 1200,
  maxRetriesPerRequest: 0,
});
const ratesPrefix =
  process.env.PHASE5_GUARD_TARGET === 'phase-5-test' || process.env.PHASE6_TEST_GUARD === '1'
    ? (process.env.BULLMQ_PREFIX ?? 'phase5-test') + ':'
    : '';
const rates = new RatesService(new RedisJsonCache(ratesRedis, ratesPrefix), logger);

app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY || false);
app.use(helmet());
app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
app.use(requestLogger(logger));
app.use(express.json({ limit: '1mb' }));
app.use(
  '/api',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests', details: null } },
  }),
);

app.get('/api/v1/health', (_request, response) => {
  response.json({ status: 'ok' });
});
app.get('/health', (_request, response) => {
  response.json({ status: 'ok' });
});
app.get('/health/ready', readiness([() => prisma.$queryRaw`SELECT 1`, () => ratesRedis.ping()]));
const openApiDocument = createOpenApiDocument();
app.get('/docs/openapi.json', (_request, response) => {
  response.json(openApiDocument);
});
app.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(undefined, { swaggerOptions: { url: '/docs/openapi.json' } }),
);
app.use('/api/v1', createDealsRouter(prisma));
app.use('/api/v1', createCuratedDealsRouter(prisma));
app.use('/api/v1', createGamesRouter(prisma));
app.use('/api/v1', createTaxonomyRouter(prisma));
app.use('/api/v1', createCurrencyRouter(prisma, rates, env.JWT_ACCESS_SECRET, env.JWT_ISSUER));
app.use(
  '/api/v1/auth',
  createAuthRouter(prisma, {
    accessSecret: env.JWT_ACCESS_SECRET,
    issuer: env.JWT_ISSUER,
    webOrigin: env.WEB_ORIGIN,
    cookieSecure: env.AUTH_COOKIE_SECURE,
    cookieSameSite: env.AUTH_COOKIE_SAME_SITE,
    rateLimitWindowMs: env.AUTH_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
    rateLimitMax: env.AUTH_RATE_LIMIT_MAX,
  }),
);
app.use('/api/v1/wishlist', createWishlistRouter(prisma, env.JWT_ACCESS_SECRET, env.JWT_ISSUER));
app.use('/api/v1', createAlertsRouter(prisma, env.JWT_ACCESS_SECRET, env.JWT_ISSUER));
app.use('/api/v1', createNotificationsRouter(prisma, env.JWT_ACCESS_SECRET, env.JWT_ISSUER));

app.use((_request, response) => {
  response.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Route not found', details: null },
  });
});

app.use(requestErrorHandler(logger));

export { app, ratesRedis };
