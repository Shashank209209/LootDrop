import { Prisma, type PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import express, { type Request, type Response, type Router } from 'express';
import rateLimit from 'express-rate-limit';
import { loginRequestSchema, registerRequestSchema, type AuthUser } from '@dealhunter/contracts';
import { sendApiError } from '../http/api-error.js';
import { signAccessToken } from './jwt.js';
import { hashSeedPassword } from './password.js';
import { createRequireAuth } from './require-auth.js';

const refreshCookieName = 'lootdrop_refresh';
const refreshTokenLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const dummyHashPromise = hashSeedPassword('lootdrop-unknown-account-password');

const publicUserSelect = {
  id: true,
  email: true,
  displayName: true,
} satisfies Prisma.UserSelect;

type PublicUserRecord = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;
type AuthDatabase = Pick<PrismaClient, '$transaction' | 'user' | 'refreshToken'>;
type RefreshTokenDelegate = Pick<Prisma.TransactionClient, 'refreshToken'>;

export type AuthRouterOptions = {
  accessSecret: string;
  issuer: string;
  cookieSecure: boolean;
  cookieSameSite: 'lax' | 'strict' | 'none';
  rateLimitWindowMs: number;
  rateLimitMax: number;
};

function toAuthUser(user: PublicUserRecord): AuthUser {
  return { id: user.id, email: user.email, displayName: user.displayName };
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function readRefreshCookie(request: Request): string | null {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return null;
  const prefix = `${refreshCookieName}=`;
  const cookie = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!cookie) return null;
  try {
    return decodeURIComponent(cookie.slice(prefix.length)) || null;
  } catch {
    return null;
  }
}

function setRefreshCookie(response: Response, token: string, options: AuthRouterOptions): void {
  response.cookie(refreshCookieName, token, {
    httpOnly: true,
    secure: options.cookieSecure,
    sameSite: options.cookieSameSite,
    path: '/api/v1/auth',
    maxAge: refreshTokenLifetimeMs,
  });
}

function clearRefreshCookie(response: Response, options: AuthRouterOptions): void {
  response.clearCookie(refreshCookieName, {
    httpOnly: true,
    secure: options.cookieSecure,
    sameSite: options.cookieSameSite,
    path: '/api/v1/auth',
  });
}

async function createRefreshToken(
  transaction: RefreshTokenDelegate,
  userId: string,
): Promise<string> {
  const rawToken = randomBytes(32).toString('base64url');
  await transaction.refreshToken.create({
    data: {
      userId,
      tokenHash: tokenHash(rawToken),
      expiresAt: new Date(Date.now() + refreshTokenLifetimeMs),
    },
  });
  return rawToken;
}

function sendInvalidBody(response: Response, message: string): void {
  sendApiError(response, 400, 'INVALID_REQUEST', message);
}

function sendInvalidCredentials(response: Response): void {
  sendApiError(response, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export function createAuthRouter(database: AuthDatabase, options: AuthRouterOptions): Router {
  const router = express.Router();
  const requireAuth = createRequireAuth(options.accessSecret, options.issuer);
  const authRateLimit = rateLimit({
    windowMs: options.rateLimitWindowMs,
    limit: options.rateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_request, response) => {
      sendApiError(response, 429, 'RATE_LIMITED', 'Too many authentication attempts');
    },
  });

  router.post('/register', authRateLimit, async (request, response, next) => {
    const parsed = registerRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      sendInvalidBody(response, parsed.error.issues.map((issue) => issue.message).join('; '));
      return;
    }

    try {
      const passwordHash = await hashSeedPassword(parsed.data.password);
      const result = await database.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: {
            email: parsed.data.email,
            passwordHash,
            displayName: parsed.data.displayName,
          },
          select: publicUserSelect,
        });
        const refreshToken = await createRefreshToken(transaction, user.id);
        return { user, refreshToken };
      });

      response.setHeader('Cache-Control', 'no-store');
      setRefreshCookie(response, result.refreshToken, options);
      response.status(201).json({
        user: toAuthUser(result.user),
        accessToken: signAccessToken(result.user.id, options.accessSecret, options.issuer),
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        sendApiError(
          response,
          409,
          'REGISTRATION_UNAVAILABLE',
          'Unable to register with these details',
        );
        return;
      }
      next(error);
    }
  });

  router.post('/login', authRateLimit, async (request, response, next) => {
    const parsed = loginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      sendInvalidBody(response, parsed.error.issues.map((issue) => issue.message).join('; '));
      return;
    }

    try {
      const [user, dummyHash] = await Promise.all([
        database.user.findUnique({
          where: { email: parsed.data.email },
          select: { ...publicUserSelect, passwordHash: true },
        }),
        dummyHashPromise,
      ]);
      const passwordMatches = await bcrypt.compare(
        parsed.data.password,
        user?.passwordHash ?? dummyHash,
      );
      if (!user || !passwordMatches) {
        sendInvalidCredentials(response);
        return;
      }

      const refreshToken = await createRefreshToken(database, user.id);
      response.setHeader('Cache-Control', 'no-store');
      setRefreshCookie(response, refreshToken, options);
      response.status(200).json({
        user: toAuthUser(user),
        accessToken: signAccessToken(user.id, options.accessSecret, options.issuer),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/refresh', async (request, response, next) => {
    const rawToken = readRefreshCookie(request);
    if (!rawToken) {
      clearRefreshCookie(response, options);
      sendApiError(response, 401, 'UNAUTHORIZED', 'Refresh session is invalid');
      return;
    }

    const now = new Date();
    try {
      const result = await database.$transaction(async (transaction) => {
        const stored = await transaction.refreshToken.findUnique({
          where: { tokenHash: tokenHash(rawToken) },
          select: {
            id: true,
            userId: true,
            expiresAt: true,
            revokedAt: true,
            user: { select: publicUserSelect },
          },
        });
        if (!stored) return { kind: 'invalid' as const };
        if (stored.revokedAt) {
          await transaction.refreshToken.updateMany({
            where: { userId: stored.userId },
            data: { revokedAt: now },
          });
          return { kind: 'reuse' as const };
        }
        if (stored.expiresAt <= now) {
          await transaction.refreshToken.updateMany({
            where: { id: stored.id, revokedAt: null },
            data: { revokedAt: now },
          });
          return { kind: 'invalid' as const };
        }

        const revoked = await transaction.refreshToken.updateMany({
          where: { id: stored.id, revokedAt: null, expiresAt: { gt: now } },
          data: { revokedAt: now },
        });
        if (revoked.count !== 1) {
          await transaction.refreshToken.updateMany({
            where: { userId: stored.userId },
            data: { revokedAt: now },
          });
          return { kind: 'reuse' as const };
        }

        const refreshToken = await createRefreshToken(transaction, stored.userId);
        return { kind: 'rotated' as const, refreshToken, user: stored.user };
      });

      if (result.kind !== 'rotated') {
        clearRefreshCookie(response, options);
        sendApiError(response, 401, 'UNAUTHORIZED', 'Refresh session is invalid');
        return;
      }
      response.setHeader('Cache-Control', 'no-store');
      setRefreshCookie(response, result.refreshToken, options);
      response.status(200).json({
        user: toAuthUser(result.user),
        accessToken: signAccessToken(result.user.id, options.accessSecret, options.issuer),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/logout', async (request, response, next) => {
    const rawToken = readRefreshCookie(request);
    try {
      if (rawToken) {
        await database.refreshToken.updateMany({
          where: { tokenHash: tokenHash(rawToken), revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      clearRefreshCookie(response, options);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get('/me', requireAuth, async (_request, response, next) => {
    const userId: unknown = response.locals.userId;
    if (typeof userId !== 'string') {
      sendApiError(response, 401, 'UNAUTHORIZED', 'Authentication required');
      return;
    }
    try {
      const user = await database.user.findUnique({
        where: { id: userId },
        select: publicUserSelect,
      });
      if (!user) {
        sendApiError(response, 401, 'UNAUTHORIZED', 'Authentication required');
        return;
      }
      response.setHeader('Cache-Control', 'no-store');
      response.status(200).json({ user: toAuthUser(user) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export { refreshCookieName };
