import type { Logger } from 'pino';

export type AlertEmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export interface Mailer {
  send(message: AlertEmailMessage): Promise<void>;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function createLogMailer(logger: Logger): Mailer {
  return {
    async send(message) {
      void message;
      logger.info({ provider: 'log', recipient: '***' }, 'Alert email suppressed');
    },
  };
}

export function createResendMailer(input: {
  apiKey: string;
  from: string;
  fetcher?: typeof fetch;
}): Mailer {
  const fetcher = input.fetcher ?? fetch;
  return {
    async send(message) {
      const response = await fetcher('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: input.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });
      if (!response.ok) {
        throw new Error(`Resend request failed with status ${response.status}`);
      }
    },
  };
}

export function createMailer(input: {
  provider: 'log' | 'resend';
  logger: Logger;
  resendApiKey?: string | undefined;
  emailFrom?: string | undefined;
}): Mailer {
  if (input.provider === 'log') return createLogMailer(input.logger);
  if (!input.resendApiKey || !input.emailFrom) {
    throw new Error('Resend mail configuration is incomplete');
  }
  return createResendMailer({ apiKey: input.resendApiKey, from: input.emailFrom });
}
