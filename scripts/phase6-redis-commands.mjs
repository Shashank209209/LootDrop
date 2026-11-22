import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as wait } from 'node:timers/promises';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { createJobWorker } from '../apps/api/src/jobs/job-worker.ts';

const [serverPath, mode] = process.argv.slice(2);
if (!serverPath || !['baseline', 'tuned'].includes(mode)) {
  throw new Error('Pass the redis-server executable path and either baseline or tuned');
}
const executable = resolve(serverPath);
const cli = join(dirname(executable), 'redis-cli' + extname(executable));
const names = ['sync-deals', 'evaluate-alerts', 'alert-emails'];

function redisProcess(executablePath, args, cwd) {
  return spawn(executablePath, args, {
    cwd,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

async function waitForLine(child, matches) {
  const reader = createInterface({ input: child.stdout });
  return new Promise((resolveReady, reject) => {
    child.once('error', reject);
    child.once('exit', () => reject(new Error('Disposable Redis process exited before readiness')));
    reader.on('line', (line) => {
      if (matches(line)) resolveReady(reader);
    });
  });
}

async function stop(child) {
  if (child && child.exitCode === null && child.signalCode === null && child.pid) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
}

async function readStats(connection) {
  const text = await connection.info('commandstats');
  return Object.fromEntries(
    [...text.matchAll(/^cmdstat_([^:]+):calls=(\d+),/gm)].map(([, name, count]) => [
      name,
      Number(count),
    ]),
  );
}

async function measure(name, index) {
  const port = 16410 + index;
  const directory = await mkdtemp(join(tmpdir(), 'lootdrop-redis-bench-'));
  const config = join(directory, 'redis.conf');
  const prefix = 'phase6-bench-' + randomUUID();
  await writeFile(
    config,
    `bind 127.0.0.1\nprotected-mode yes\nport ${port}\nsave ""\nappendonly no\n`,
  );
  const server = redisProcess(executable, ['redis.conf'], directory);
  let connection;
  let queue;
  let worker;
  let monitor;
  try {
    await waitForLine(server, (line) => line.includes('Ready to accept connections'));
    connection = new Redis({ host: '127.0.0.1', port, maxRetriesPerRequest: null });
    const options = { connection, prefix };
    queue = new Queue(name, options);
    if (name === 'sync-deals') {
      for (const [schedule, minutes] of [
        ['cheapshark-deals-sync', 45],
        ['enrich-metadata', 60],
      ]) {
        const every = minutes * 60_000;
        await queue.upsertJobScheduler(
          schedule,
          { every, startDate: new Date(Date.now() + every) },
          { name: schedule },
        );
      }
    }
    monitor = redisProcess(cli, ['-h', '127.0.0.1', '-p', String(port), 'MONITOR'], directory);
    const lines = await waitForLine(monitor, (line) => line === 'OK');
    const client = {};
    const lua = {};
    let recording = false;
    lines.on('line', (line) => {
      if (!recording) return;
      const match = /\[\d+ ([^\]]+)\] "([^"]+)"/.exec(line);
      if (!match || match[2] === 'info') return;
      const counts = match[1] === 'lua' ? lua : client;
      counts[match[2]] = (counts[match[2]] ?? 0) + 1;
    });
    worker =
      mode === 'tuned'
        ? createJobWorker(name, async () => {}, options)
        : new Worker(name, async () => {}, { ...options, concurrency: 1, drainDelay: 30 });
    await worker.waitUntilReady();
    await wait(1800);
    const before = await readStats(connection);
    const start = performance.now();
    recording = true;
    await wait(180_000);
    recording = false;
    const seconds = Math.round((performance.now() - start) / 10) / 100;
    const after = await readStats(connection);
    const info = Object.fromEntries(
      Object.entries(after)
        .filter(([command, count]) => command !== 'info' && count > (before[command] ?? 0))
        .map(([command, count]) => [command, count - (before[command] ?? 0)]),
    );
    return { queue: name, seconds, client, lua, info };
  } finally {
    await Promise.allSettled([worker?.close(true), queue?.close()]);
    connection?.disconnect();
    await Promise.allSettled([stop(monitor), stop(server)]);
    await unlink(config);
    await rmdir(directory);
  }
}

const results = await Promise.allSettled(names.map(measure));
if (results.some(({ status }) => status === 'rejected')) {
  throw new Error('One or more local Redis measurements failed');
}
console.log(JSON.stringify({ mode, queues: results.map(({ value }) => value) }, null, 2));
