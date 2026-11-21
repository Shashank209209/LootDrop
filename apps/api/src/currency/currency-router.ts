import { Prisma, type PrismaClient } from '@prisma/client';
import { preferenceSchema } from '@dealhunter/contracts';
import { Router } from 'express';
import { createRequireAuth } from '../auth/require-auth.js';
import { sendApiError } from '../http/api-error.js';
import type { RatesService } from './rates-service.js';

export function createCurrencyRouter(
  database: Pick<PrismaClient, 'user'>,
  rates: Pick<RatesService, 'getRates'>,
  secret: string,
  issuer: string,
): Router {
  const router = Router();

  router.get('/rates', async (_request, response, next) => {
    try {
      const result = await rates.getRates();
      response.setHeader('Cache-Control', 'no-store');
      if (!result) {
        sendApiError(
          response,
          503,
          'RATES_UNAVAILABLE',
          'Exchange rates are temporarily unavailable',
        );
        return;
      }
      response.setHeader('X-Rates-Cache', result.cache);
      response.json(result.data);
    } catch (error) {
      next(error);
    }
  });

  router.patch(
    '/me/preferences',
    createRequireAuth(secret, issuer),
    async (request, response, next) => {
      const userId: unknown = response.locals.userId;
      if (typeof userId !== 'string') {
        sendApiError(response, 401, 'UNAUTHORIZED', 'Authentication required');
        return;
      }
      const parsed = preferenceSchema.safeParse(request.body);
      if (!parsed.success) {
        sendApiError(response, 400, 'INVALID_REQUEST', 'Provide a supported display currency');
        return;
      }
      try {
        const preference = await database.user.update({
          where: { id: userId },
          data: parsed.data,
          select: { preferredCurrency: true },
        });
        response.setHeader('Cache-Control', 'no-store');
        response.json(preference);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
          sendApiError(response, 401, 'UNAUTHORIZED', 'Authentication required');
          return;
        }
        next(error);
      }
    },
  );

  return router;
}
