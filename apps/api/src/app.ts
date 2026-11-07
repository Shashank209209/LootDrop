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

const logger = pino({ level: env.LOG_LEVEL });
const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: env.WEB_ORIGIN }));
app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({ logger }));
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
