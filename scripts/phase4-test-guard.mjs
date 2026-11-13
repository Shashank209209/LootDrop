import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');

function stop(message) {
  console.error(`Phase 4 test guard: ${message}`);
  process.exit(2);
}

let storedEnv;
try {
  storedEnv = parse(readFileSync(envPath));
} catch {
  stop('root .env is unavailable.');
}

const directTestUrl = storedEnv.DIRECT_URL_PHASE4_TEST?.trim();
const pooledTestUrl = storedEnv.DATABASE_URL_PHASE4_TEST?.trim();
if (!directTestUrl) stop('DIRECT_URL_PHASE4_TEST is missing.');
if (!pooledTestUrl) stop('DATABASE_URL_PHASE4_TEST is missing.');

const productionUrls = [storedEnv.DATABASE_URL, storedEnv.DIRECT_URL].filter(
  (value) => typeof value === 'string' && value.length > 0,
);
const databaseIdentity = (value) => {
  try {
    const url = new URL(value);
    return `${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ''}/${url.pathname.replace(/^\/+/, '')}`;
  } catch {
    return null;
  }
};
const productionIdentities = new Set(productionUrls.map(databaseIdentity).filter(Boolean));
if (
  [directTestUrl, pooledTestUrl].some(
    (testUrl) =>
      productionUrls.includes(testUrl) || productionIdentities.has(databaseIdentity(testUrl)),
  )
) {
  stop('A test database URL matches a production database URL.');
}

let direct;
let pooled;
try {
  direct = new URL(directTestUrl);
  pooled = new URL(pooledTestUrl);
} catch {
  stop('A Phase 4 test database URL is invalid.');
}

if (
  direct.hostname.endsWith('-pooler.neon.tech') ||
  !direct.hostname.endsWith('.neon.tech') ||
  !pooled.hostname.endsWith('.neon.tech') ||
  direct.pathname.replace(/^\/+/, '') !== 'neondb' ||
  pooled.pathname.replace(/^\/+/, '') !== 'neondb'
) {
  stop('The test URLs do not match the expected direct and pooled Neon neondb targets.');
}

const commandArgs = process.argv.slice(2);
if (commandArgs[0] !== '--' || commandArgs.length < 2) {
  stop('Pass a command after --, for example: node scripts/phase4-test-guard.mjs -- npm run test');
}

console.log('target: lootdrop / phase-4-test / neondb');
const executable = commandArgs[1];
const args = commandArgs.slice(2);
const endpointHosts = [direct.hostname, pooled.hostname];
const result = spawnSync(executable, args, {
  cwd: root,
  env: {
    ...process.env,
    DATABASE_URL: pooledTestUrl,
    DIRECT_URL: directTestUrl,
    EMAIL_PROVIDER: 'log',
    BULLMQ_PREFIX: 'phase4test',
    PHASE4_TEST_GUARD: '1',
  },
  encoding: 'utf8',
  shell: process.platform === 'win32',
});

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  .replaceAll(directTestUrl, '[redacted database URL]')
  .replaceAll(pooledTestUrl, '[redacted database URL]')
  .replace(
    new RegExp(
      endpointHosts.map((host) => host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
      'g',
    ),
    '[Neon endpoint redacted]',
  )
  .replace(/(postgres(?:ql)?:\/\/)[^\s"'@]+:[^\s"'@]+@/gi, '$1[redacted]@');
if (output) process.stdout.write(output);
if (result.error) {
  stop('The requested command could not be started.');
}
process.exit(result.status ?? 1);
