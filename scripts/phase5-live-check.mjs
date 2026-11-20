import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';

const exec = promisify(execFile);
const node = process.execPath;
const npm = process.env.npm_execpath ?? resolve(dirname(node), 'node_modules/npm/bin/npm-cli.js');
const disabledMessage = 'RAWG_API_KEY is missing; metadata enrichment is disabled';
const curlCommand = process.platform === 'win32' ? 'curl.exe' : 'curl';

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function print(label, data) {
  console.log(label + ' ' + JSON.stringify(data));
}

async function start(script, env, ready) {
  const child = spawn(node, ['--import', 'tsx', script], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    output += chunk;
  });
  const closed = once(child, 'close');
  const timeout = Date.now() + 15_000;
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
  };
  try {
    while (!output.includes(ready) && child.exitCode === null && Date.now() < timeout) {
      await delay(100);
    }
    check(output.includes(ready), 'A guarded service failed to start: ' + script);
    return { output: () => output, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

async function pickPort() {
  const listener = createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  const closed = once(listener, 'close');
  listener.close();
  await closed;
  return port;
}

async function enrich(env) {
  const { stdout, stderr } = await exec(node, [npm, 'run', 'enrich:once', '--', '--limit', '10'], {
    env,
    timeout: 120_000,
    windowsHide: true,
  });
  if (!env.RAWG_API_KEY) {
    check(
      stderr.split(disabledMessage).length === 2,
      'One-off job did not emit one missing-key warning',
    );
    print('keyless enrich:once', { exitCode: 0, warning: disabledMessage });
    return;
  }
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith('{"examined":'));
  check(line, 'One-off job did not emit its run result');
  return JSON.parse(line);
}

async function snapshot(db) {
  return db.game.findMany({
    where: { rawgId: { not: null } },
    select: { id: true, updatedAt: true, _count: { select: { genres: true, platforms: true } } },
  });
}

async function verifyKeyless() {
  const env = { ...process.env, RAWG_API_KEY: '', API_PORT: String(await pickPort()) };
  for (const [label, script, ready] of [
    ['API', 'apps/api/src/server.ts', 'DealHunter API listening'],
    ['worker', 'apps/api/src/jobs/sync-deals-worker.ts', 'ready without recurring schedules'],
  ]) {
    const service = await start(script, env, ready);
    try {
      await delay(150);
      check(
        service.output().split(disabledMessage).length === 2,
        label + ' did not emit one missing-key warning',
      );
      print('keyless ' + label, { started: true, warning: disabledMessage });
    } finally {
      await service.stop();
    }
  }
  await enrich(env);
}

async function verifyRequests(slugs) {
  const port = await pickPort();
  const service = await start(
    'apps/api/src/server.ts',
    { ...process.env, API_PORT: String(port) },
    'DealHunter API listening',
  );
  const base = 'http://127.0.0.1:' + port + '/api/v1';
  try {
    async function curl(path, trim, status = 200) {
      const { stdout } = await exec(
        curlCommand,
        [
          '--silent',
          '--show-error',
          '--max-time',
          '20',
          '--write-out',
          '\n%{http_code}',
          base + path,
        ],
        { windowsHide: true },
      );
      const split = stdout.lastIndexOf('\n');
      const actual = Number(stdout.slice(split + 1));
      const body = JSON.parse(stdout.slice(0, split));
      print(curlCommand + ' ' + path, { status: actual, body: trim(body) });
      check(actual === status, 'Unexpected HTTP status from ' + path + ': ' + actual);
      return body;
    }
    const facets = ({ data }) => ({ data: data.slice(0, 6), returned: data.length });
    const genres = (await curl('/genres', facets)).data;
    const platforms = (await curl('/platforms', facets)).data;
    const deals = ({ data, pagination }) => ({
      data: data.map(({ gameSlug, gameTitle, genres, platforms, userRating }) => ({
        gameSlug,
        gameTitle,
        genres,
        platforms,
        userRating,
      })),
      totalItems: pagination.totalItems,
    });
    const sort = '/deals?pageSize=2&sort=rating_desc';
    const sales = (await curl(sort, deals)).data;
    const genre = genres[0]?.slug ?? 'action';
    const platform = platforms[0]?.slug ?? 'pc';
    await curl(sort + '&genre=' + encodeURIComponent(genre), deals);
    await curl(sort + '&platform=' + encodeURIComponent(platform), deals);
    await curl(
      sort + '&genre=' + encodeURIComponent(genre) + '&platform=' + encodeURIComponent(platform),
      deals,
    );
    await curl('/deals?genre=phase5-check-unknown', (body) => body, 400);
    const samples = slugs.length ? slugs : sales.slice(0, 1).map((game) => game.gameSlug);
    for (const slug of samples) {
      await curl('/games/' + encodeURIComponent(slug), ({ data: { game } }) => ({
        ...game,
        description: game.description?.slice(0, 120) ?? null,
      }));
    }
  } finally {
    await service.stop();
  }
}

async function main() {
  const proof = createHash('sha256')
    .update(process.env.DATABASE_URL ?? '')
    .update('\0')
    .update(process.env.DIRECT_URL ?? '')
    .digest('hex');
  check(
    process.env.PHASE5_GUARD_TARGET === 'phase-5-test' &&
      process.env.PHASE5_GUARD_FINGERPRINT === proof &&
      process.env.BULLMQ_PREFIX?.startsWith('phase5-') &&
      process.env.DISABLE_REPEATABLE_SCHEDULES === '1',
    'Run this check through the Phase 5 child branch guard',
  );
  check(process.env.RAWG_API_KEY, 'RAWG_API_KEY is missing');
  await verifyKeyless();

  const database = new PrismaClient({ log: [], errorFormat: 'minimal' });
  try {
    const first = await enrich(process.env);
    print('run 1', first);
    check(first.stopped !== 'quota', 'RAWG quota or access limit reached');
    const before = await snapshot(database);
    const second = await enrich(process.env);
    print('run 2', second);
    check(second.stopped !== 'quota', 'RAWG quota or access limit reached');
    const after = new Map((await snapshot(database)).map((game) => [game.id, game]));
    const rewritten = before.filter(
      (game) => JSON.stringify(after.get(game.id)) !== JSON.stringify(game),
    );
    print('repeat verification', {
      existingEnrichedRows: before.length,
      rewrittenRows: rewritten.length,
      negativeCacheHits: second.negativeCacheHits,
      requestsUsed: first.requestsUsed + second.requestsUsed,
    });
    check(rewritten.length === 0, 'The second batch changed previously enriched rows');
    const samples = [
      ...new Set([...first.samples, ...second.samples].map((game) => game.slug)),
    ].slice(0, 3);
    await verifyRequests(samples);
    check(samples.length === 3, 'The live run did not produce three sample games');
    if (first.noMatch + first.ambiguous + first.conflicts > 0) {
      check(second.negativeCacheHits > 0, 'The second batch did not observe the negative cache');
    }
  } finally {
    await database.$disconnect();
  }
}

main().catch((error) => {
  const safeMessage =
    error instanceof Error && !error.code && !error.stack?.includes('Prisma')
      ? error.message
      : 'A guarded command or database query failed';
  console.error('Phase 5 live check failed: ' + safeMessage);
  process.exitCode = 1;
});
