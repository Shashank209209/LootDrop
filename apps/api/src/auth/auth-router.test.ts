import { Prisma, type PrismaClient } from '@prisma/client';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { hashSeedPassword } from './password.js';
import { createAuthRouter, refreshCookieName } from './auth-router.js';

const accessSecret = 'unit-test-access-secret-longer-than-thirty-two-characters';
const issuer = 'lootdrop-test';
const knownPassword = 'correct-test-password';
const knownUserId = '20da2e1d-c56e-4874-8e7c-f5d15d38d502';
const knownEmail = 'known@example.test';
const knownDisplayName = 'Known User';
const servers: Array<ReturnType<express.Express['listen']>> = [];
let knownPasswordHash: string;

type UserRecord = {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
};

type RefreshRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

beforeAll(async () => {
  knownPasswordHash = await hashSeedPassword(knownPassword);
});

function createTestApi(options: { rateLimitMax?: number } = {}) {
  const users = new Map<string, UserRecord>();
  const refreshTokens = new Map<string, RefreshRecord>();
  const knownUser = {
    id: knownUserId,
    email: knownEmail,
    displayName: knownDisplayName,
    passwordHash: knownPasswordHash,
  };
  users.set(knownEmail, knownUser);

  const transaction = {
    user: {
      create: vi.fn(async ({ data }: { data: Omit<UserRecord, 'id'> }) => {
        if (users.has(data.email)) {
          throw new Prisma.PrismaClientKnownRequestError('unique constraint', {
            code: 'P2002',
            clientVersion: 'test',
          });
        }
        const user = { ...data, id: randomUUID() };
        users.set(user.email, user);
        return { id: user.id, email: user.email, displayName: user.displayName };
      }),
      findUnique: vi.fn(
        async ({ where }: { where: { email?: string; id?: string } }) =>
          [...users.values()].find(
            (user) =>
              (where.email !== undefined && user.email === where.email) ||
              (where.id !== undefined && user.id === where.id),
          ) ?? null,
      ),
    },
    refreshToken: {
      create: vi.fn(async ({ data }: { data: Omit<RefreshRecord, 'id' | 'revokedAt'> }) => {
        const record = { ...data, id: randomUUID(), revokedAt: null };
        refreshTokens.set(record.tokenHash, record);
        return record;
      }),
      findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => {
        const token = refreshTokens.get(where.tokenHash);
        if (!token) return null;
        const user = [...users.values()].find((candidate) => candidate.id === token.userId);
        return user
          ? {
              id: token.id,
              userId: token.userId,
              expiresAt: token.expiresAt,
              revokedAt: token.revokedAt,
              user: { id: user.id, email: user.email, displayName: user.displayName },
            }
          : null;
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id?: string; tokenHash?: string; userId?: string; revokedAt?: null };
          data: { revokedAt: Date };
        }) => {
          let count = 0;
          for (const token of refreshTokens.values()) {
            if (
              (where.id === undefined || token.id === where.id) &&
              (where.tokenHash === undefined || token.tokenHash === where.tokenHash) &&
              (where.userId === undefined || token.userId === where.userId) &&
              (where.revokedAt !== null || token.revokedAt === null)
            ) {
              token.revokedAt = data.revokedAt;
              count += 1;
            }
          }
          return { count };
        },
      ),
    },
  };
  const database = {
    ...transaction,
    $transaction: vi.fn(async <T>(callback: (tx: typeof transaction) => Promise<T>): Promise<T> =>
      callback(transaction),
    ),
  } as unknown as PrismaClient;

  const app = express();
  app.use(express.json());
  app.use(
    '/api/v1/auth',
    createAuthRouter(database, {
      accessSecret,
      issuer,
      cookieSecure: false,
      cookieSameSite: 'lax',
      rateLimitWindowMs: 60_000,
      rateLimitMax: options.rateLimitMax ?? 10,
    }),
  );
  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      next: express.NextFunction,
    ) => {
      void next;
      response.status(500).json({ error: { code: 'TEST_ERROR', message: 'Test request failed' } });
    },
  );
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a port');

  return {
    users,
    refreshTokens,
    transaction,
    request: (path: string, init?: RequestInit) =>
      fetch(`http://127.0.0.1:${address.port}/api/v1/auth${path}`, init),
  };
}

function cookieFrom(response: Response): string {
  const cookie = response.headers.get('set-cookie');
  const value = cookie?.match(new RegExp(`${refreshCookieName}=([^;]+)`))?.[1];
  if (!value) throw new Error('Refresh cookie was not set');
  return `${refreshCookieName}=${value}`;
}

function postJson(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

describe('auth routes', () => {
  it('registers normalized emails and stores only a hashed refresh token', async () => {
    const api = createTestApi();
    const response = await api.request(
      '/register',
      postJson({
        email: '  New.User@Example.Test ',
        password: 'register-password-123',
        displayName: '  New User  ',
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.user).toMatchObject({
      email: 'new.user@example.test',
      displayName: 'New User',
    });
    expect(body).not.toHaveProperty('passwordHash');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('Path=/api/v1/auth');
    expect(api.refreshTokens.size).toBe(1);
    expect([...api.refreshTokens.keys()][0]).not.toBe(cookieFrom(response).split('=')[1]);
  });

  it('returns a generic conflict for a duplicate email', async () => {
    const api = createTestApi();
    const response = await api.request(
      '/register',
      postJson({
        email: knownEmail,
        password: 'register-password-123',
        displayName: 'Duplicate',
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: 'REGISTRATION_UNAVAILABLE', message: 'Unable to register with these details' },
    });
  });

  it('rejects invalid emails and passwords outside 12 to 128 characters', async () => {
    const api = createTestApi();
    for (const body of [
      { email: 'not-an-email', password: 'long-enough-password', displayName: 'Name' },
      { email: 'user@example.test', password: 'short', displayName: 'Name' },
      { email: 'user@example.test', password: 'p'.repeat(129), displayName: 'Name' },
      { email: 'user@example.test', password: 'long-enough-password', displayName: '  ' },
    ]) {
      const response = await api.request('/register', postJson(body));
      expect(response.status).toBe(400);
    }
  });

  it('logs in and gives the same 401 response for a wrong password and unknown email', async () => {
    const api = createTestApi();
    const login = async (email: string, password: string) =>
      api.request('/login', postJson({ email, password }));

    const success = await login(` ${knownEmail.toUpperCase()} `, knownPassword);
    expect(success.status).toBe(200);
    expect((await success.json()).user).toEqual({
      id: knownUserId,
      email: knownEmail,
      displayName: knownDisplayName,
    });
    expect(success.headers.get('set-cookie')).toContain('HttpOnly');

    const wrongPassword = await login(knownEmail, 'incorrect-test-password');
    const unknownEmail = await login('missing@example.test', 'incorrect-test-password');
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    const wrongPasswordBody = await wrongPassword.json();
    const unknownEmailBody = await unknownEmail.json();
    expect(wrongPasswordBody).toEqual(unknownEmailBody);
    expect(wrongPasswordBody).toMatchObject({
      error: { message: 'Invalid email or password' },
    });
  });

  it('rotates refresh tokens and revokes the user token family when an old token is reused', async () => {
    const api = createTestApi();
    const registered = await api.request(
      '/register',
      postJson({
        email: 'rotate@example.test',
        password: 'register-password-123',
        displayName: 'Rotate',
      }),
    );
    const oldCookie = cookieFrom(registered);
    const refreshed = await api.request('/refresh', {
      method: 'POST',
      headers: { Cookie: oldCookie },
    });
    const newCookie = cookieFrom(refreshed);

    expect(refreshed.status).toBe(200);
    expect(newCookie).not.toBe(oldCookie);
    expect(api.refreshTokens.size).toBe(2);

    const reuse = await api.request('/refresh', {
      method: 'POST',
      headers: { Cookie: oldCookie },
    });
    expect(reuse.status).toBe(401);
    expect([...api.refreshTokens.values()].every((token) => token.revokedAt !== null)).toBe(true);
    expect(reuse.headers.get('set-cookie')).toContain('Expires=Thu, 01 Jan 1970');
  });

  it('rejects expired refresh tokens and clears the cookie', async () => {
    const api = createTestApi();
    const expired = await api.request(
      '/register',
      postJson({
        email: 'expired@example.test',
        password: 'register-password-123',
        displayName: 'Expired',
      }),
    );
    const cookie = cookieFrom(expired);
    const hash = [...api.refreshTokens.keys()].at(-1);
    const token = hash ? api.refreshTokens.get(hash) : undefined;
    if (!token) throw new Error('Expected created refresh token');
    token.expiresAt = new Date(Date.now() - 1000);

    const response = await api.request('/refresh', {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toContain('Expires=Thu, 01 Jan 1970');
  });

  it('logs out idempotently, revokes the cookie token, and clears the cookie', async () => {
    const api = createTestApi();
    const registered = await api.request(
      '/register',
      postJson({
        email: 'logout@example.test',
        password: 'register-password-123',
        displayName: 'Logout',
      }),
    );
    const cookie = cookieFrom(registered);
    const logout = await api.request('/logout', { method: 'POST', headers: { Cookie: cookie } });

    expect(logout.status).toBe(204);
    expect(logout.headers.get('set-cookie')).toContain('Expires=Thu, 01 Jan 1970');
    expect([...api.refreshTokens.values()].some((token) => token.revokedAt !== null)).toBe(true);

    const invalidLogout = await api.request('/logout', {
      method: 'POST',
      headers: { Cookie: `${refreshCookieName}=invalid` },
    });
    expect(invalidLogout.status).toBe(204);
  });

  it('protects /me and accepts a valid access token', async () => {
    const api = createTestApi();
    const unauthorized = await api.request('/me');
    expect(unauthorized.status).toBe(401);
    const login = await api.request(
      '/login',
      postJson({ email: knownEmail, password: knownPassword }),
    );
    const { accessToken } = await login.json();
    const me = await api.request('/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({
      user: { id: knownUserId, email: knownEmail, displayName: knownDisplayName },
    });
  });

  it('returns a standard 429 response when the auth rate limit is exceeded', async () => {
    const api = createTestApi({ rateLimitMax: 1 });
    const input = postJson({ email: 'bad@example.test', password: 'long-enough-password' });
    expect((await api.request('/login', input)).status).toBe(401);
    const limited = await api.request('/login', input);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({
      error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts' },
    });
  });
});
