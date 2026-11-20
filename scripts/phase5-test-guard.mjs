import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function stop(reason) {
  console.error('Phase 5 guard: ' + reason);
  process.exit(2);
}

function endpoint(value) {
  const url = new URL(value);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname.endsWith('.neon.tech') ||
    url.pathname !== '/neondb'
  ) {
    throw new Error('Unexpected database endpoint');
  }
  return url.hostname;
}

function pair(direct, pooled) {
  const host = endpoint(direct);
  const pool = endpoint(pooled);
  if (host.includes('-pooler.') || host.replace('.', '-pooler.') !== pool) {
    throw new Error('Unexpected direct and pooled endpoint pair');
  }
  return host;
}

let stored;
try {
  stored = parse(readFileSync(resolve(root, '.env')));
} catch {
  stop('root .env is unavailable');
}

const delimiter = process.argv.indexOf('--', 2);
const flags = process.argv.slice(2, delimiter < 0 ? undefined : delimiter);
const production = flags.includes('--production');
const checkOnly = flags.includes('--check-only');
const command = delimiter < 0 ? [] : process.argv.slice(delimiter + 1);
if (
  flags.some((flag) => !['--production', '--without-key', '--check-only'].includes(flag)) ||
  (checkOnly ? command.length > 0 : command.length === 0)
) {
  stop('use --check-only or pass a command after --');
}
if (
  production &&
  !checkOnly &&
  (command.slice(0, 4).join(' ') !== 'npm run enrich:once --' ||
    !command.slice(4).includes('--allow-production'))
) {
  stop('production requires the enrich:once command with --allow-production');
}

const directName = production ? 'DIRECT_URL' : 'DIRECT_URL_PHASE5_TEST';
const pooledName = production ? 'DATABASE_URL' : 'DATABASE_URL_PHASE5_TEST';
const direct = stored[directName]?.trim();
const pooled = stored[pooledName]?.trim();
if (!direct) stop(directName + ' is missing');
if (!pooled) stop(pooledName + ' is missing');
if (!production && [direct, pooled].some((value) => /channel_binding/i.test(value))) {
  stop('a test database URL contains channel_binding');
}
try {
  const target = pair(direct, pooled);
  const identity = (value) => new URL(value).hostname.replace('-pooler.', '.');
  if (!production) {
    if (!stored.DIRECT_URL || !stored.DATABASE_URL)
      stop('production comparison values are missing');
    if ([stored.DIRECT_URL, stored.DATABASE_URL].some((value) => identity(value) === target)) {
      stop('the test database endpoint matches production');
    }
    if (
      [stored.DIRECT_URL_PHASE4_TEST, stored.DATABASE_URL_PHASE4_TEST].some(
        (value) => value && identity(value) === target,
      )
    ) {
      stop('the test endpoint matches the Phase 4 child branch');
    }
  }
} catch {
  stop('database URLs do not match the expected direct and pooled Neon neondb targets');
}

const targetName = production ? 'production' : 'phase-5-test';
console.log('target: lootdrop / ' + targetName + ' / neondb');
if (checkOnly) process.exit(0);

const env = {
  ...process.env,
  DATABASE_URL: pooled,
  DIRECT_URL: direct,
  RAWG_API_KEY: flags.includes('--without-key') ? '' : (stored.RAWG_API_KEY ?? ''),
  PHASE5_GUARD_TARGET: targetName,
  PHASE5_GUARD_FINGERPRINT: createHash('sha256')
    .update(pooled)
    .update('\0')
    .update(direct)
    .digest('hex'),
  ...(!production
    ? {
        BULLMQ_PREFIX: 'phase5-' + randomUUID(),
        DISABLE_REPEATABLE_SCHEDULES: '1',
        EMAIL_PROVIDER: 'log',
      }
    : {}),
};
for (const name of ['DEBUG', 'NODE_DEBUG', 'NODE_DEBUG_NATIVE', 'RUST_LOG']) delete env[name];

let [executable, ...args] = command;
if (executable === 'npm' || executable === 'npm.cmd') {
  const npmCli =
    process.env.npm_execpath ??
    resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  if (!existsSync(npmCli)) stop('npm CLI could not be located');
  executable = process.execPath;
  args = [npmCli, ...args];
} else if (executable === 'node' || executable === 'node.exe') {
  executable = process.execPath;
}

const privateValues = new Set();
for (const name of [
  'RAWG_API_KEY',
  'REDIS_URL',
  'DATABASE_URL',
  'DIRECT_URL',
  'DATABASE_URL_PHASE5_TEST',
  'DIRECT_URL_PHASE5_TEST',
  'JWT_ACCESS_SECRET',
  'RESEND_API_KEY',
  'DEMO_USER_PASSWORD',
]) {
  for (const value of [stored[name], process.env[name]]) {
    if (!value) continue;
    privateValues.add(value);
    if (name.endsWith('URL') || name.includes('_URL_')) {
      try {
        const url = new URL(value);
        privateValues.add(url.hostname);
        if (url.password) {
          privateValues.add(url.password);
          privateValues.add(decodeURIComponent(url.password));
        }
      } catch {
        // Redact the original value even if it is not a URL.
      }
    }
    privateValues.add(encodeURIComponent(value));
  }
}
const secrets = [...privateValues].sort((a, b) => b.length - a.length);
const redact = (line) =>
  secrets
    .reduce((safe, secret) => safe.replaceAll(secret, '[redacted]'), line)
    .replace(/(?:postgres(?:ql)?|rediss?):\/\/[^\s"'<>]+/gi, '[redacted connection string]')
    .replace(/([?&]key=)[^&\s"']+/gi, '$1[redacted]');
const child = spawn(executable, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
for (const [stream, output] of [
  [child.stdout, process.stdout],
  [child.stderr, process.stderr],
]) {
  createInterface({ input: stream }).on('line', (line) => output.write(redact(line) + '\n'));
}
child.once('error', () => stop('the requested command could not start'));
child.once('close', (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal));
}
