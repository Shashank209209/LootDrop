import { Prisma, type PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import { moneyNumber } from '../pricing/deal-serialization.js';
import { escapeHtml, type Mailer } from './mailer.js';

const emailNotificationSelect = {
  id: true,
  status: true,
  user: { select: { email: true } },
  alert: { select: { game: { select: { title: true } } } },
  listing: {
    select: {
      currentPrice: true,
      currency: true,
      store: { select: { name: true } },
    },
  },
} satisfies Prisma.NotificationSelect;

type EmailNotification = Prisma.NotificationGetPayload<{
  select: typeof emailNotificationSelect;
}>;

type EmailDatabase = Pick<PrismaClient, 'notification'>;

function subjectText(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export function createAlertEmail(notification: EmailNotification) {
  const game = notification.alert.game.title;
  const store = notification.listing.store.name;
  const currency = notification.listing.currency;
  const amount = new Intl.NumberFormat('en', { style: 'currency', currency }).format(
    moneyNumber(notification.listing.currentPrice) ?? 0,
  );
  const subject = `${subjectText(game)} dropped to ${amount} at ${subjectText(store)}`;
  const text = `${game} dropped to ${amount} at ${store}.`;
  const html = `<p><strong>${escapeHtml(game)}</strong> dropped to <strong>${escapeHtml(amount)}</strong> at <strong>${escapeHtml(store)}</strong>.</p>`;
  return { to: notification.user.email, subject, text, html };
}

export async function runAlertEmail(
  notificationId: string,
  input: {
    database: EmailDatabase;
    mailer: Mailer;
    logger: Logger;
    attemptsMade: number;
    maxAttempts: number;
  },
): Promise<void> {
  const notification = await input.database.notification.findUnique({
    where: { id: notificationId },
    select: emailNotificationSelect,
  });
  if (!notification || notification.status !== 'PENDING') return;

  try {
    await input.mailer.send(createAlertEmail(notification));
    await input.database.notification.updateMany({
      where: { id: notification.id, status: 'PENDING' },
      data: { status: 'SENT', sentAt: new Date() },
    });
  } catch (error) {
    if (input.attemptsMade + 1 >= input.maxAttempts) {
      await input.database.notification.updateMany({
        where: { id: notification.id, status: 'PENDING' },
        data: { status: 'FAILED', message: 'Email delivery failed' },
      });
      input.logger.error(
        { notificationId, errorName: error instanceof Error ? error.name : 'UnknownError' },
        'Alert email delivery failed after retries',
      );
    }
    throw error;
  }
}
