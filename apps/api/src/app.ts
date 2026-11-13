import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { prisma } from './db/prisma.js';
import { createDealsRouter } from './pricing/deals-router.js';
import { createGamesRouter } from './games/games-router.js';
import { createCuratedDealsRouter } from './pricing/curated-deals-router.js';
import { createOpenApiDocument } from './openapi.js';
import { createAuthRouter } from './auth/auth-router.js';
import { createWishlistRouter } from './wishlist/wishlist-router.js';
import { createAlertsRouter } from './alerts/alerts-router.js';
import { createNotificationsRouter } from './alerts/notifications-router.js';
import { sendApiError } from './http/api-error.js';

const logger = pino({ level: env.LOG_LEVEL });
const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(
  pinoHttp({
    logger,
    serializers: {
      req: (request) => ({
        id: request.id,
        method: request.method,
        url: request.url,
        remoteAddress: request.remoteAddress,
      }),
      res: (response) => ({ statusCode: response.statusCode }),
    },
  }),
);
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
app.use(
  '/api/v1/auth',
  createAuthRouter(prisma, {
    accessSecret: env.JWT_ACCESS_SECRET,
    issuer: env.JWT_ISSUER,
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

const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error instanceof SyntaxError && 'body' in error) {
    sendApiError(response, 400, 'INVALID_REQUEST', 'Request body must be valid JSON');
    return;
  }

  logger.error(
    { errorName: error instanceof Error ? error.name : 'UnknownError' },
    'Unhandled request error',
  );
  response.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
      details: null,
    },
  });
};

app.use(errorHandler);

export { app };
