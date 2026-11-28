import { Prisma, type AccountLink, type PrismaClient } from '@prisma/client';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { hashSeedPassword } from './password.js';
import { createAuthRouter, refreshCookieName } from './auth-router.js';
import { createCurrencyRouter } from '../currency/currency-router.js';
import { signAccessToken } from './jwt.js';
import type { Mailer } from '../alerts/mailer.js';
import { tokenHash } from './account-links.js';

const accessSecret = 'unit-test-access-secret-longer-than-thirty-two-characters';
const issuer = 'lootdrop-test';
const webOrigin = 'https://web.example.test';
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
  passwordVersion: number;
  emailVerifiedAt: Date | null;
  preferredCurrency: string;
};

type RefreshRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  passwordVersion: number;
  expiresAt: Date;
  revokedAt: Date | null;
};

beforeAll(async () => {
  knownPasswordHash = await hashSeedPassword(knownPassword);
});

function createTestApi(
  options: { rateLimitMax?: number; ratesAvailable?: boolean; accountMailer?: Mailer } = {},
) {
  const users = new Map<string, UserRecord>();
  const refreshTokens = new Map<string, RefreshRecord>();
  const links = new Map<string, AccountLink>();
  const knownUser = {
    id: knownUserId,
    email: knownEmail,
    displayName: knownDisplayName,
    passwordHash: knownPasswordHash,
    passwordVersion: 0,
    emailVerifiedAt: null,
    preferredCurrency: 'USD',
  };
  users.set(knownEmail, knownUser);

  const transaction = {
    user: {
      create: vi.fn(
        async ({ data }: { data: Pick<UserRecord, 'email' | 'displayName' | 'passwordHash'> }) => {
          if (users.has(data.email)) {
            throw new Prisma.PrismaClientKnownRequestError('unique constraint', {
              code: 'P2002',
              clientVersion: 'test',
            });
          }
          const user = {
            preferredCurrency: 'USD',
            passwordVersion: 0,
            emailVerifiedAt: null,
            ...data,
            id: randomUUID(),
          };
          users.set(user.email, user);
          return user;
        },
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { email?: string; id?: string } }) =>
          [...users.values()].find(
            (user) =>
              (where.email !== undefined && user.email === where.email) ||
              (where.id !== undefined && user.id === where.id),
          ) ?? null,
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: {
            preferredCurrency?: string;
            passwordHash?: string;
            passwordVersion?: { increment: number };
          };
        }) => {
          const user = [...users.values()].find(({ id }) => id === where.id);
          if (!user) throw new Error('Unknown test user');
          if (data.preferredCurrency) user.preferredCurrency = data.preferredCurrency;
          if (data.passwordHash) user.passwordHash = data.passwordHash;
          user.passwordVersion += data.passwordVersion?.increment ?? 0;
          return { preferredCurrency: user.preferredCurrency };
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; emailVerifiedAt: null };
          data: { emailVerifiedAt: Date };
        }) => {
          const user = [...users.values()].find(({ id }) => id === where.id);
          if (!user || user.emailVerifiedAt !== where.emailVerifiedAt) return { count: 0 };
          user.emailVerifiedAt = data.emailVerifiedAt;
          return { count: 1 };
        },
      ),
    },
    accountLink: {
      createMany: vi.fn(async ({ data }: { data: AccountLink }) => {
        if (
          [...links.values()].some(
            (link) => link.userId === data.userId && link.purpose === data.purpose,
          )
        ) {
          return { count: 0 };
        }
        links.set(data.tokenHash, data);
        return { count: 1 };
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { userId: string; purpose: AccountLink['purpose']; expiresAt: { lte: Date } };
          data: Pick<AccountLink, 'tokenHash' | 'expiresAt'>;
        }) => {
          const link = [...links.values()].find(
            (candidate) =>
              candidate.userId === where.userId &&
              candidate.purpose === where.purpose &&
              candidate.expiresAt <= where.expiresAt.lte,
          );
          if (!link) return { count: 0 };
          links.delete(link.tokenHash);
          links.set(data.tokenHash, { ...link, ...data });
          return { count: 1 };
        },
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { tokenHash: string } }) => links.get(where.tokenHash) ?? null,
      ),
      deleteMany: vi.fn(
        async ({
          where,
        }: {
          where: { tokenHash: string; purpose: AccountLink['purpose']; expiresAt: { gt: Date } };
        }) => {
          const link = links.get(where.tokenHash);
          if (!link || link.purpose !== where.purpose || link.expiresAt <= where.expiresAt.gt) {
            return { count: 0 };
          }
          links.delete(where.tokenHash);
          return { count: 1 };
        },
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
              passwordVersion: token.passwordVersion,
              user: { ...user },
            }
          : null;
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: {
            id?: string;
            tokenHash?: string;
            userId?: string;
            revokedAt?: null;
            passwordVersion?: number;
          };
          data: { revokedAt: Date };
        }) => {
          let count = 0;
          for (const token of refreshTokens.values()) {
            if (
              (where.id === undefined || token.id === where.id) &&
              (where.tokenHash === undefined || token.tokenHash === where.tokenHash) &&
              (where.userId === undefined || token.userId === where.userId) &&
              (where.passwordVersion === undefined ||
                token.passwordVersion === where.passwordVersion) &&
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
    '/api/v1',
    createCurrencyRouter(
      database,
      {
        getRates: async () =>
          options.ratesAvailable
            ? {
                cache: 'redis',
                data: {
                  base: 'USD',
                  rates: { USD: 1, INR: 86, EUR: 0.88 },
                  asOf: '2026-01-01T00:00:00.000Z',
                  source: 'Test',
                  stale: false,
                },
              }
            : null,
      },
      accessSecret,
      issuer,
    ),
  );
  app.use(
    '/api/v1/auth',
    createAuthRouter(database, {
      accessSecret,
      issuer,
      webOrigin,
      cookieSecure: false,
      cookieSameSite: 'lax',
      rateLimitWindowMs: 60_000,
      rateLimitMax: options.rateLimitMax ?? 10,
      ...(options.accountMailer ? { accountMailer: options.accountMailer } : {}),
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
    links,
    refreshTokens,
    transaction,
    request: (path: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (!headers.has('Origin') && !headers.has('Referer')) headers.set('Origin', webOrigin);
      return fetch(`http://127.0.0.1:${address.port}/api/v1/auth${path}`, { ...init, headers });
    },
    currency: (path: string, init?: RequestInit) =>
      fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, init),
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

function accountEmailFixture() {
  const send = vi.fn<Mailer['send']>().mockResolvedValue(undefined);
  const api = createTestApi({ accountMailer: { send }, rateLimitMax: 30 });
  const post = (path: string, body: unknown, userId?: string) => {
    const init = postJson(body);
    const headers = new Headers(init.headers);
    if (userId)
      headers.set('Authorization', `Bearer ${signAccessToken(userId, accessSecret, issuer)}`);
    return api.request(path, { ...init, headers });
  };
  async function readLink(path: string) {
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    const message = send.mock.calls.at(-1)?.[0];
    const emailUrl = message?.text.match(/https:\/\/[^\s]+/)?.[0];
    if (!emailUrl) throw new Error('Expected a link in the test email');
    const url = new URL(emailUrl);
    expect(url.origin).toBe(webOrigin);
    expect(url.pathname).toBe(path);
    expect(url.search).toBe('');
    const token = new URLSearchParams(url.hash.slice(1)).get('token');
    if (!token) throw new Error('Expected a token in the link fragment');
    return token;
  }
  return { ...api, send, post, readLink };
}

describe('account email links', () => {
  it('accepts recovery requests generically, stores only a hash, and allows just one reset', async () => {
    const api = accountEmailFixture();
    const unknown = await api.post('/forgot-password', { email: 'missing@example.test' });
    expect(unknown.status).toBe(204);
    expect(await unknown.text()).toBe('');
    const initial = await api.post('/login', { email: knownEmail, password: knownPassword });
    const cookie = cookieFrom(initial);
    expect((await api.post('/forgot-password', { email: knownEmail.toUpperCase() })).status).toBe(
      204,
    );
    const token = await api.readLink('/reset-password');
    expect(api.send).toHaveBeenCalledTimes(1);
    expect(api.send.mock.calls[0]?.[0].to).toBe(knownEmail);
    expect(api.links.has(token)).toBe(false);
    const stored = api.links.get(tokenHash(token));
    expect(stored?.purpose).toBe('PASSWORD_RESET');
    expect(stored?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect((await api.post('/forgot-password', { email: knownEmail })).status).toBe(204);
    await vi.waitFor(() => expect(api.transaction.accountLink.updateMany).toHaveBeenCalled());
    expect(api.send).toHaveBeenCalledTimes(1);
    expect((await api.post('/verify-email', { token }, knownUserId)).status).toBe(400);

    const password = 'different-password-after-reset';
    const attempts = await Promise.all([
      api.post('/reset-password', { token, password }),
      api.post('/reset-password', { token, password }),
    ]);
    expect(attempts.map((response) => response.status).sort()).toEqual([204, 400]);
    expect(api.users.get(knownEmail)?.passwordVersion).toBe(1);
    expect([...api.refreshTokens.values()].every((refresh) => refresh.revokedAt !== null)).toBe(
      true,
    );
    // Even a refresh session created during the reset cannot refresh with the old password version.
    const oldRefresh = [...api.refreshTokens.values()][0]!;
    oldRefresh.revokedAt = null;
    expect(
      (await api.request('/refresh', { method: 'POST', headers: { Cookie: cookie } })).status,
    ).toBe(401);
    expect((await api.post('/login', { email: knownEmail, password: knownPassword })).status).toBe(
      401,
    );
    expect((await api.post('/login', { email: knownEmail, password })).status).toBe(200);
  });

  it('sends verification on registration and only verifies the matching signed-in account', async () => {
    const api = accountEmailFixture();
    const email = 'new-player@example.test';
    const registration = await api.post('/register', {
      email,
      displayName: 'New Player',
      password: knownPassword,
    });
    expect(registration.status).toBe(201);
    const session = await registration.json();
    expect(session.user.emailVerified).toBe(false);
    const token = await api.readLink('/verify-email');
    expect((await api.post('/verify-email', { token })).status).toBe(401);
    expect((await api.post('/verify-email', { token }, knownUserId)).status).toBe(400);
    expect((await api.post('/verify-email', { token }, session.user.id)).status).toBe(204);
    expect((await api.post('/verify-email', { token }, session.user.id)).status).toBe(400);
    const me = await api.request('/me', {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    expect((await me.json()).user.emailVerified).toBe(true);
  });

  it('rejects expired links and does not consume them on a cross-origin request', async () => {
    const api = accountEmailFixture();
    expect((await api.post('/resend-verification', {}, knownUserId)).status).toBe(204);
    const token = await api.readLink('/verify-email');
    const tokenRecord = api.links.get(tokenHash(token))!;
    const init = postJson({ token });
    const headers = new Headers(init.headers);
    headers.set('Origin', 'https://different.example.test');
    headers.set('Authorization', `Bearer ${signAccessToken(knownUserId, accessSecret, issuer)}`);
    expect((await api.request('/verify-email', { ...init, headers })).status).toBe(403);
    expect(api.links.has(tokenHash(token))).toBe(true);
    tokenRecord.expiresAt = new Date(0);
    expect((await api.post('/verify-email', { token }, knownUserId)).status).toBe(400);
    expect(api.users.get(knownEmail)?.emailVerifiedAt).toBeNull();
  });
});

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
  it.each(['/refresh', '/logout'])(
    'blocks a foreign origin before using a cookie on %s',
    async (path) => {
      const api = createTestApi();
      const response = await api.request(path, {
        method: 'POST',
        headers: {
          Origin: 'null',
          Referer: webOrigin + '/account',
          Cookie: refreshCookieName + '=fixture',
        },
      });
      expect(response.status).toBe(403);
      expect(response.headers.has('set-cookie')).toBe(false);
      expect(api.transaction.refreshToken.updateMany).not.toHaveBeenCalled();
    },
  );

  it('accepts a same-origin Referer when the Origin header is absent', async () => {
    const api = createTestApi();
    const response = await api.request('/logout', {
      method: 'POST',
      headers: { Referer: webOrigin + '/account' },
    });
    expect(response.status).toBe(204);
  });
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
      emailVerified: false,
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
      user: {
        id: knownUserId,
        email: knownEmail,
        displayName: knownDisplayName,
        preferredCurrency: 'USD',
        emailVerified: false,
      },
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

describe('currency routes', () => {
  function patch(body: unknown, userId?: string): RequestInit {
    return {
      ...postJson(body),
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(userId
          ? { Authorization: `Bearer ${signAccessToken(userId, accessSecret, issuer)}` }
          : {}),
      },
    };
  }

  it('exposes public rates and a cache indicator', async () => {
    const response = await createTestApi({ ratesAvailable: true }).currency('/rates');
    expect(response.status).toBe(200);
    expect(response.headers.get('x-rates-cache')).toBe('redis');
    expect(await response.json()).toMatchObject({ base: 'USD', stale: false });
  });

  it('returns 503 and a standard error with an empty cache', async () => {
    const response = await createTestApi().currency('/rates');
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'RATES_UNAVAILABLE' } });
  });

  it('requires authentication to change a preference', async () => {
    const api = createTestApi();
    const response = await api.currency('/me/preferences', patch({ preferredCurrency: 'EUR' }));
    expect(response.status).toBe(401);
    expect(api.transaction.user.update).not.toHaveBeenCalled();
  });

  it('saves the preference and exposes it through auth/me', async () => {
    const api = createTestApi();
    const response = await api.currency(
      '/me/preferences',
      patch({ preferredCurrency: 'INR' }, knownUserId),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ preferredCurrency: 'INR' });
    const me = await api.request('/me', {
      headers: { Authorization: `Bearer ${signAccessToken(knownUserId, accessSecret, issuer)}` },
    });
    expect(await me.json()).toMatchObject({ user: { preferredCurrency: 'INR' } });
  });

  it.each([{ preferredCurrency: 'JPY' }, { preferredCurrency: 'EUR', extra: true }])(
    'rejects an invalid preference payload %#',
    async (body) => {
      const api = createTestApi();
      expect((await api.currency('/me/preferences', patch(body, knownUserId))).status).toBe(400);
      expect(api.transaction.user.update).not.toHaveBeenCalled();
    },
  );

  it('can only update the row identified by the token', async () => {
    const api = createTestApi();
    const other = {
      id: randomUUID(),
      email: 'other@example.test',
      displayName: 'Other',
      passwordHash: knownPasswordHash,
      passwordVersion: 0,
      emailVerifiedAt: null,
      preferredCurrency: 'USD',
    };
    api.users.set(other.email, other);
    expect(
      (
        await api.currency(
          '/me/preferences',
          patch({ preferredCurrency: 'EUR', userId: knownUserId }, other.id),
        )
      ).status,
    ).toBe(400);
    expect(
      (await api.currency('/me/preferences', patch({ preferredCurrency: 'EUR' }, other.id))).status,
    ).toBe(200);
    expect(api.users.get(knownEmail)?.preferredCurrency).toBe('USD');
    expect(other.preferredCurrency).toBe('EUR');
  });
});
