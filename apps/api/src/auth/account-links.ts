import { type AccountLinkPurpose, type PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { escapeHtml, type Mailer } from '../alerts/mailer.js';
import { hashSeedPassword } from './password.js';

export type AccountLinkDatabase = Pick<PrismaClient, '$transaction' | 'accountLink' | 'user'>;

const linkOptions = {
  PASSWORD_RESET: {
    path: '/reset-password',
    action: 'Reset your password',
    expiresIn: '30 minutes',
    lifetimeMs: 30 * 60_000,
  },
  EMAIL_VERIFICATION: {
    path: '/verify-email',
    action: 'Verify your email',
    expiresIn: '24 hours',
    lifetimeMs: 24 * 60 * 60_000,
  },
} satisfies Record<
  AccountLinkPurpose,
  { path: string; action: string; expiresIn: string; lifetimeMs: number }
>;

const resendCooldownMs = 60_000;

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function sendAccountLink(
  database: AccountLinkDatabase,
  mailer: Mailer,
  webOrigin: string,
  user: { id: string; email: string },
  purpose: AccountLinkPurpose,
): Promise<void> {
  const options = linkOptions[purpose];
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAt = new Date(now + options.lifetimeMs);
  const data = { tokenHash: tokenHash(token), expiresAt };
  const where = { userId: user.id, purpose };
  const created = await database.accountLink.createMany({
    data: { ...where, ...data },
    skipDuplicates: true,
  });
  if (created.count === 0) {
    const updated = await database.accountLink.updateMany({
      where: { ...where, expiresAt: { lte: new Date(expiresAt.getTime() - resendCooldownMs) } },
      data,
    });
    if (updated.count === 0) return;
  }

  const url = new URL(options.path, webOrigin);
  url.hash = new URLSearchParams({ token }).toString();
  const instructions = `This link expires in ${options.expiresIn}. If you did not request this, you can ignore this email.`;
  await mailer.send({
    to: user.email,
    subject: `${options.action} | LootDrop`,
    text: `${options.action}: ${url.href}\n\n${instructions}`,
    html: `<p><a href="${escapeHtml(url.href)}">${options.action}</a></p><p>${instructions}</p>`,
  });
}

export async function consumeAccountLink(
  database: AccountLinkDatabase,
  token: string,
  action:
    | { purpose: 'EMAIL_VERIFICATION'; userId: string }
    | { purpose: 'PASSWORD_RESET'; password: string },
): Promise<boolean> {
  const hash = tokenHash(token);
  const accountLink = await database.accountLink.findUnique({
    where: { tokenHash: hash },
    select: { userId: true, purpose: true, expiresAt: true },
  });
  if (
    !accountLink ||
    accountLink.purpose !== action.purpose ||
    (action.purpose === 'EMAIL_VERIFICATION' && accountLink.userId !== action.userId) ||
    accountLink.expiresAt.getTime() <= Date.now()
  ) {
    return false;
  }

  const passwordHash =
    action.purpose === 'PASSWORD_RESET' ? await hashSeedPassword(action.password) : undefined;
  return database.$transaction(async (transaction) => {
    const now = new Date();
    const consumed = await transaction.accountLink.deleteMany({
      where: { tokenHash: hash, purpose: action.purpose, expiresAt: { gt: now } },
    });
    if (consumed.count !== 1) return false;

    if (passwordHash === undefined) {
      await transaction.user.updateMany({
        where: { id: accountLink.userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: now },
      });
    } else {
      await transaction.user.update({
        where: { id: accountLink.userId },
        data: { passwordHash, passwordVersion: { increment: 1 } },
      });
      await transaction.refreshToken.updateMany({
        where: { userId: accountLink.userId, revokedAt: null },
        data: { revokedAt: now },
      });
    }
    return true;
  });
}
