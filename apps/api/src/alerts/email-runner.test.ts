import { Prisma } from '@prisma/client';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { runAlertEmail } from './email-runner.js';
import { createLogMailer, createResendMailer, type Mailer } from './mailer.js';

function notificationDatabase() {
  return {
    notification: {
      findUnique: vi.fn(async () => ({
        id: 'notification-id',
        status: 'PENDING',
        user: { email: 'owner@example.invalid' },
        alert: { game: { title: '<script>Game & One</script>' } },
        listing: {
          currentPrice: new Prisma.Decimal('4.50'),
          currency: 'USD',
          store: { name: '<img src=x onerror=alert(1)>' },
        },
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
}

describe('alert email delivery', () => {
  it('sends only to the owner and escapes dynamic HTML values', async () => {
    const database = notificationDatabase();
    const send = vi.fn<Mailer['send']>(async () => {});

    await runAlertEmail('notification-id', {
      database: database as never,
      mailer: { send },
      logger: pino({ level: 'silent' }),
      attemptsMade: 0,
      maxAttempts: 3,
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'owner@example.invalid',
        subject: '<script>Game & One</script> dropped to $4.50 at <img src=x onerror=alert(1)>',
        html: expect.not.stringContaining('<script>'),
      }),
    );
    expect(send.mock.calls[0]?.[0].html).toContain('&lt;script&gt;Game &amp; One');
    expect(send.mock.calls[0]?.[0].html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(database.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SENT' }),
      }),
    );
  });

  it('leaves transient failures for retry and marks the final failure', async () => {
    const database = notificationDatabase();
    const send = vi.fn<Mailer['send']>(async () => {
      throw new Error('provider unavailable');
    });
    const dependencies = {
      database: database as never,
      mailer: { send },
      logger: pino({ level: 'silent' }),
      maxAttempts: 3,
    };

    await expect(
      runAlertEmail('notification-id', { ...dependencies, attemptsMade: 0 }),
    ).rejects.toThrow('provider unavailable');
    expect(database.notification.updateMany).not.toHaveBeenCalled();

    await expect(
      runAlertEmail('notification-id', { ...dependencies, attemptsMade: 2 }),
    ).rejects.toThrow('provider unavailable');
    expect(database.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'FAILED', message: 'Email delivery failed' },
      }),
    );
  });

  it('logs a masked line and does not send when log is selected', async () => {
    const lines: string[] = [];
    const logger = pino({ level: 'info' }, { write: (line) => lines.push(line) });
    const mailer = createLogMailer(logger);

    await mailer.send({
      to: 'owner@example.invalid',
      subject: 'Subject',
      html: '<p>Message</p>',
      text: 'Message',
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('owner@example.invalid');
    expect(lines[0]).toContain('"recipient":"***"');
  });

  it('posts the owner email and content to Resend without exposing response bodies', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(url).toBe('https://api.resend.com/emails');
      expect(init?.method).toBe('POST');
      return new Response(null, { status: 202 });
    });
    const mailer = createResendMailer({
      apiKey: 'test-secret',
      from: 'LootDrop <alerts@example.invalid>',
      fetcher,
    });

    await mailer.send({
      to: 'owner@example.invalid',
      subject: 'Subject',
      html: '<p>Message</p>',
      text: 'Message',
    });
    const request = fetcher.mock.calls[0]?.[1];
    expect(request?.headers).toMatchObject({ Authorization: 'Bearer test-secret' });
    expect(JSON.parse(String(request?.body))).toMatchObject({
      to: ['owner@example.invalid'],
      subject: 'Subject',
    });
  });
});
