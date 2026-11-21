import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { signAccessToken } from '../apps/api/src/auth/jwt.ts';
import { env } from '../apps/api/src/config/env.ts';
import { freshRatesKey, lastKnownRatesKey } from '../apps/api/src/currency/rates-service.ts';

class CheckFailure extends Error {}
function check(condition, message) {
  if (!condition) throw new CheckFailure(message);
}

const appCode = `if (process.env.PHASE5B_TEST_OUTAGE === '1') {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, options) => {
    if (typeof input === 'string' && new URL(input).hostname === 'api.frankfurter.dev') {
      return Promise.reject(new DOMException('Simulated provider outage', 'TimeoutError'));
    }
    return originalFetch(input, options);
  };
}
const { app } = await import('./apps/api/src/app.ts');
const server = app.listen(0, '127.0.0.1', () => console.log('PHASE5B_PORT=' + server.address().port));`;

async function startApi(outage = false) {
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', appCode], {
    env: { ...process.env, PHASE5B_TEST_OUTAGE: outage ? '1' : '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = once(child, 'close');
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    output = (output + chunk).slice(-4096);
  });
  child.stderr.resume();
  async function stop() {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
  }
  const deadline = Date.now() + 20_000;
  while (child.exitCode === null && Date.now() < deadline) {
    const port = /PHASE5B_PORT=(\d+)/.exec(output)?.[1];
    if (port) return { port, stop };
    await delay(100);
  }
  await stop();
  throw new CheckFailure('Guarded API could not start');
}

async function curl(port, path, { method = 'GET', token, body } = {}) {
  const executable = process.platform === 'win32' ? 'curl.exe' : 'curl';
  const args = [
    '--silent',
    '--show-error',
    '--max-time',
    '20',
    '--dump-header',
    '-',
    '--config',
    '-',
  ];
  const processCurl = spawn(executable, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  processCurl.stderr.resume();
  processCurl.stdin.on('error', () => {});
  let output = '';
  processCurl.stdout.setEncoding('utf8').on('data', (chunk) => {
    output += chunk;
  });
  const closed = once(processCurl, 'close');
  // Feed headers through stdin so access tokens stay out of command-line arguments.
  const config = [
    'url = ' + JSON.stringify('http://127.0.0.1:' + port + '/api/v1' + path),
    'request = ' + method,
  ];
  if (token) config.push('header = ' + JSON.stringify('Authorization: Bearer ' + token));
  if (body !== undefined) {
    config.push('header = "Content-Type: application/json"');
    config.push('data-binary = ' + JSON.stringify(JSON.stringify(body)));
  }
  processCurl.stdin.end(config.join('\n') + '\n');
  const [code] = await closed;
  check(code === 0, 'curl failed for ' + path);
  const headerEnd = /\r?\n\r?\n/.exec(output);
  check(headerEnd, 'curl response was missing HTTP headers');
  const headers = output.slice(0, headerEnd.index);
  const status = Number(/^HTTP\/\S+ (\d+)/.exec(headers)?.[1]);
  const cache = /^X-Rates-Cache:\s*(\S+)/im.exec(headers)?.[1];
  const data = JSON.parse(output.slice(headerEnd.index + headerEnd[0].length));
  return { status, cache, data };
}

function print(label, response, data, expected) {
  console.log(
    'curl.exe ' +
      label +
      ' ' +
      JSON.stringify({
        status: response.status,
        ...(response.cache ? { cache: response.cache } : {}),
        body: data,
      }),
  );
  check(
    response.status === expected,
    label + ' returned HTTP ' + response.status + ', expected ' + expected,
  );
}

function makeUser() {
  const id = randomUUID();
  return {
    id,
    email: 'phase5b-check-' + id + '@example.invalid',
    passwordHash: 'phase5b-login-disabled',
    displayName: 'Phase 5B live check',
    preferredCurrency: 'USD',
  };
}

function prices(response) {
  check(
    response.status === 200 && response.data.data.length === 5,
    'Deals sample did not return five listings',
  );
  return response.data.data.map(({ id, gameTitle, currentPrice, regularPrice, currency }) => ({
    id,
    gameTitle,
    currentPrice,
    regularPrice,
    currency,
  }));
}

async function main() {
  const fingerprint = createHash('sha256')
    .update(env.DATABASE_URL)
    .update('\0')
    .update(process.env.DIRECT_URL ?? '')
    .digest('hex');
  const prefix = process.env.BULLMQ_PREFIX;
  check(
    process.env.PHASE5_GUARD_TARGET === 'phase-5-test' &&
      process.env.PHASE5_GUARD_FINGERPRINT === fingerprint &&
      process.env.DISABLE_REPEATABLE_SCHEDULES === '1' &&
      /^phase5-[0-9a-f-]{36}$/.test(prefix ?? ''),
    'Run this check through the Phase 5 child branch guard',
  );

  const database = new PrismaClient({ log: [], errorFormat: 'minimal' });
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    commandTimeout: 5000,
  });
  const freshKey = prefix + ':' + freshRatesKey;
  const durableKey = prefix + ':' + lastKnownRatesKey;
  const users = [makeUser(), makeUser()];
  const where = { OR: users.map(({ id, email }) => ({ id, email })) };
  const dealsPath = '/deals?pageSize=5&sort=price_asc';
  let api;
  let created = 0;

  try {
    api = await startApi();
    const initial = await curl(api.port, '/rates');
    print('GET /rates fresh', initial, initial.data, 200);
    check(
      initial.cache === 'provider' && initial.data.stale === false,
      'First response did not come from the provider',
    );
    await api.stop();
    api = await startApi();
    const cached = await curl(api.port, '/rates');
    print('GET /rates cached', cached, cached.data, 200);
    check(
      cached.cache === 'redis' && JSON.stringify(cached.data) === JSON.stringify(initial.data),
      'Redis cache did not return the same rates',
    );

    const baselineResponse = await curl(api.port, dealsPath);
    const baseline = prices(baselineResponse);
    print(
      'GET /deals before',
      baselineResponse,
      { sampled: baseline.length, currency: baseline[0]?.currency },
      200,
    );
    created = (await database.user.createMany({ data: users })).count;
    check(created === 2, 'Could not create both throwaway accounts');
    const tokens = users.map(({ id }) =>
      signAccessToken(id, env.JWT_ACCESS_SECRET, env.JWT_ISSUER),
    );
    async function patch(label, body, expected, userIndex) {
      const result = await curl(api.port, '/me/preferences', {
        method: 'PATCH',
        token: tokens[userIndex],
        body,
      });
      print('PATCH /me/preferences ' + label, result, result.data, expected);
    }
    async function verifyMe(userIndex, expected) {
      const result = await curl(api.port, '/auth/me', { token: tokens[userIndex] });
      const value = result.data.user?.preferredCurrency;
      print(
        'GET /auth/me user ' + (userIndex + 1),
        result,
        { user: { preferredCurrency: value } },
        200,
      );
      check(
        value === expected,
        'Saved preference did not match for throwaway account ' + (userIndex + 1),
      );
    }
    await patch('valid', { preferredCurrency: 'INR' }, 200, 0);
    await patch('invalid currency', { preferredCurrency: 'JPY' }, 400, 0);
    await patch('unauthenticated', { preferredCurrency: 'EUR' }, 401);
    await patch('cross-account attempt', { userId: users[0].id, preferredCurrency: 'EUR' }, 400, 1);
    await patch('second account own row', { preferredCurrency: 'EUR' }, 200, 1);
    await verifyMe(1, 'EUR');
    await verifyMe(0, 'INR');

    await api.stop();
    check((await redis.del(freshKey)) === 1, 'Isolated fresh cache did not exist');
    api = await startApi(true);
    const stale = await curl(api.port, '/rates');
    print('GET /rates simulated outage', stale, stale.data, 200);
    check(
      stale.cache === 'stale' &&
        stale.data.stale === true &&
        JSON.stringify(stale.data.rates) === JSON.stringify(initial.data.rates) &&
        stale.data.asOf === initial.data.asOf,
      'Provider outage did not serve last known rates',
    );

    const finalResponse = await curl(api.port, dealsPath);
    const final = prices(finalResponse);
    const pricesUnchanged = JSON.stringify(final) === JSON.stringify(baseline);
    const stillUSD = final.every(({ currency }) => currency === 'USD');
    print(
      'GET /deals after',
      finalResponse,
      { sampled: final.length, pricesUnchanged, stillUSD },
      200,
    );
    check(pricesUnchanged && stillUSD, 'Stored USD deal prices changed during the live check');
  } finally {
    try {
      await api?.stop();
    } finally {
      try {
        const deleted = (await database.user.deleteMany({ where })).count;
        const remaining = await database.user.count({ where });
        const removedKeys = await redis.del(freshKey, durableKey);
        console.log('Cleanup ' + JSON.stringify({ created, deleted, remaining, removedKeys }));
        check(deleted >= created && remaining === 0, 'Throwaway account cleanup did not complete');
      } finally {
        redis.disconnect();
        await database.$disconnect();
      }
    }
  }
}

main().catch((error) => {
  console.error(
    'Phase 5B live check failed: ' +
      (error instanceof CheckFailure
        ? error.message
        : 'guarded request or cleanup could not complete'),
  );
  process.exitCode = 1;
});
