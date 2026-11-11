import { Prisma, type PrismaClient } from '@prisma/client';
import { notificationsQuerySchema } from '@dealhunter/contracts';
import { Router, type Request, type Response } from 'express';
import { createRequireAuth } from '../auth/require-auth.js';
import { sendApiError } from '../http/api-error.js';
import { moneyNumber } from '../pricing/deal-serialization.js';

type NotificationsDatabase = Pick<PrismaClient, '$transaction' | 'notification'>;

const notificationSelect = {
  id: true,
  type: true,
  status: true,
  message: true,
  priceAtTrigger: true,
  readAt: true,
  createdAt: true,
  listing: {
    select: {
      currency: true,
      store: { select: { name: true } },
    },
  },
  alert: { select: { game: { select: { slug: true, title: true } } } },
} satisfies Prisma.NotificationSelect;

type NotificationRecord = Prisma.NotificationGetPayload<{ select: typeof notificationSelect }>;

function getUserId(response: Response): string | null {
  const userId: unknown = response.locals.userId;
  return typeof userId === 'string' ? userId : null;
}

function parseQuery(request: Request) {
  const searchParams = new URL(request.originalUrl, 'http://localhost').searchParams;
  const raw: Record<string, string> = {};
  for (const key of new Set(searchParams.keys())) {
    if (key !== 'page' && key !== 'pageSize' && key !== 'unreadOnly') {
      return { success: false as const, message: `Unknown query parameter: ${key}` };
    }
    const values = searchParams.getAll(key);
    if (values.length !== 1) {
      return {
        success: false as const,
        message: `Query parameter "${key}" may only be specified once`,
      };
    }
    const value = values[0];
    if (value !== undefined) raw[key] = value;
  }
  const parsed = notificationsQuerySchema.safeParse(raw);
  return parsed.success
    ? parsed
    : {
        success: false as const,
        message: parsed.error.issues.map((issue) => issue.message).join('; '),
      };
}

function serializeNotification(notification: NotificationRecord) {
  return {
    id: notification.id,
    type: notification.type,
    status: notification.status,
    message: notification.message,
    priceAtTrigger: moneyNumber(notification.priceAtTrigger) ?? 0,
    currency: notification.listing.currency,
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
    game: notification.alert.game,
    store: notification.listing.store,
  };
}

export function createNotificationsRouter(
  database: NotificationsDatabase,
  accessSecret: string,
  issuer: string,
): Router {
  const router = Router();
  const requireAuth = createRequireAuth(accessSecret, issuer);

  router.get('/notifications', requireAuth, async (request, response, next) => {
    const userId = getUserId(response);
    if (!userId) {
      sendApiError(response, 401, 'UNAUTHORIZED', 'Authentication required');
      return;
    }
    const parsed = parseQuery(request);
    if (!parsed.success) {
      sendApiError(response, 400, 'INVALID_QUERY', parsed.message);
      return;
    }
    const { page, pageSize, unreadOnly } = parsed.data;
    const where = { userId, ...(unreadOnly ? { readAt: null } : {}) };
    try {
      const [totalItems, records, unreadCount] = await database.$transaction(async (transaction) =>
        Promise.all([
          transaction.notification.count({ where }),
          transaction.notification.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip: (page - 1) * pageSize,
            take: pageSize,
            select: notificationSelect,
          }),
          transaction.notification.count({ where: { userId, readAt: null } }),
        ]),
      );
      const totalPages = Math.ceil(totalItems / pageSize);
      response.setHeader('Cache-Control', 'no-store');
      response.status(200).json({
        data: records.map(serializeNotification),
        pagination: {
          page,
          pageSize,
          totalItems,
          totalPages,
          hasNextPage: page < totalPages,
        },
        unreadCount,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/notifications/unread-count', requireAuth, async (_request, response, next) => {
    const userId = getUserId(response);
    if (!userId) {
      sendApiError(response, 401, 'UNAUTHORIZED', 'Authentication required');
      return;
    }
    try {
      const unreadCount = await database.notification.count({ where: { userId, readAt: null } });
      response.setHeader('Cache-Control', 'no-store');
      response.status(200).json({ unreadCount });
    } catch (error) {
      next(error);
    }
  });

  router.patch(
    '/notifications/:notificationId/read',
    requireAuth,
    async (request, response, next) => {
      const userId = getUserId(response);
      if (!userId) {
        sendApiError(response, 401, 'UNAUTHORIZED', 'Authentication required');
        return;
      }
      const notificationId = request.params.notificationId;
      if (typeof notificationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(notificationId)) {
        sendApiError(response, 400, 'INVALID_REQUEST', 'notificationId must be a UUID');
        return;
      }
      try {
        const readAt = new Date();
        const result = await database.notification.updateMany({
          where: { id: notificationId, userId, readAt: null },
          data: { readAt },
        });
        if (result.count > 0) {
          response.status(200).json({ readAt: readAt.toISOString() });
          return;
        }
        const existing = await database.notification.findFirst({
          where: { id: notificationId, userId },
          select: { readAt: true },
        });
        if (!existing) {
          sendApiError(response, 404, 'NOT_FOUND', 'Notification not found');
          return;
        }
        response.status(200).json({ readAt: existing.readAt?.toISOString() ?? null });
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch('/notifications/read-all', requireAuth, async (_request, response, next) => {
    const userId = getUserId(response);
    if (!userId) {
      sendApiError(response, 401, 'UNAUTHORIZED', 'Authentication required');
      return;
    }
    try {
      const result = await database.notification.updateMany({
        where: { userId, readAt: null },
        data: { readAt: new Date() },
      });
      response.status(200).json({ updated: result.count });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
