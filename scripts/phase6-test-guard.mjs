import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'dotenv';

const root = fileURLToPath(new URL('../', import.meta.url));
const targetLabel = 'lootdrop / phase-6-test / neondb';

function refuse(message) {
  console.error('Phase 6 test guard: ' + message);
  process.exit(2);
}

function endpoint(value) {
  const url = new URL(value);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname.endsWith('.neon.tech') ||
    url.pathname !== '/neondb'
  )
    throw new Error();
  return url.hostname;
}

function proof(database, direct) {
  return createHash('sha256').update(database).update('\0').update(direct).digest('hex');
}

export function assertPhase6Test() {
  const {
    PHASE6_TEST_GUARD,
    PHASE6_TEST_FINGERPRINT,
    DATABASE_URL,
    DIRECT_URL,
    BULLMQ_PREFIX,
    DISABLE_REPEATABLE_SCHEDULES,
  } = process.env;
  if (
    PHASE6_TEST_GUARD !== '1' ||
    !DATABASE_URL ||
    !DIRECT_URL ||
    PHASE6_TEST_FINGERPRINT !== proof(DATABASE_URL, DIRECT_URL) ||
    DISABLE_REPEATABLE_SCHEDULES !== '1' ||
    !/^phase6-[0-9a-f-]{36}$/.test(BULLMQ_PREFIX ?? '')
  ) {
    throw new Error('Run this check through the Phase 6 child branch guard');
  }
}

function launch() {
  let stored;
  try {
    stored = parse(readFileSync(new URL('../.env', import.meta.url)));
  } catch {
    refuse('root .env is unavailable');
  }
  const direct = stored.DIRECT_URL_PHASE6_TEST?.trim();
  const pooled = stored.DATABASE_URL_PHASE6_TEST?.trim();
  if (!direct || !pooled) refuse('both Phase 6 test database variables are required');
  try {
    const host = endpoint(direct);
    if (
      host.includes('-pooler.') ||
      host.replace('.', '-pooler.') !== endpoint(pooled) ||
      [direct, pooled].some((value) => /channel_binding/i.test(value))
    )
      refuse('invalid Phase 6 direct and pooled endpoint pair');
    if (!stored.DIRECT_URL || !stored.DATABASE_URL)
      refuse('production comparison variables are missing');
    const orderedNames = [
      'DIRECT_URL',
      'DATABASE_URL',
      'DIRECT_URL_PHASE4_TEST',
      'DATABASE_URL_PHASE4_TEST',
      'DIRECT_URL_PHASE5_TEST',
      'DATABASE_URL_PHASE5_TEST',
    ];
    for (const name of orderedNames) {
      if (stored[name] && new URL(stored[name]).hostname.replace('-pooler.', '.') === host) {
        refuse('the endpoint matches production or an earlier test target');
      }
    }
  } catch {
    refuse('could not validate the Neon test endpoint');
  }
  const args = process.argv.slice(2);
  console.log('target: ' + targetLabel);
  if (args.length === 1 && args[0] === '--check-only') return;
  if (args[0] !== '--' || args[1] !== 'node' || !args[2])
    refuse('pass -- node followed by the guarded command');
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: pooled,
    DIRECT_URL: direct,
    RAWG_API_KEY: '',
    EMAIL_PROVIDER: 'log',
    BULLMQ_PREFIX: 'phase6-' + randomUUID(),
    DISABLE_REPEATABLE_SCHEDULES: '1',
    PHASE6_TEST_GUARD: '1',
    PHASE6_TEST_FINGERPRINT: proof(pooled, direct),
  };
  for (const name of ['DEBUG', 'NODE_DEBUG', 'NODE_DEBUG_NATIVE', 'RUST_LOG']) delete env[name];
  const privateValues = new Set();
  for (const source of [stored, process.env]) {
    for (const [name, value] of Object.entries(source)) {
      if (
        !value ||
        !/(PASSWORD|TOKEN|SECRET|API_KEY|DATABASE_URL|DIRECT_URL|REDIS_URL)/i.test(name)
      )
        continue;
      privateValues.add(value);
      if (/(?:DATABASE_URL|DIRECT_URL|REDIS_URL)/.test(name)) {
        try {
          const url = new URL(value);
          if (url.hostname) privateValues.add(url.hostname);
          if (url.password) {
            privateValues.add(url.password);
            privateValues.add(decodeURIComponent(url.password));
          }
        } catch {
          // The full value is already excluded from output.
        }
      }
    }
  }
  const masks = [...privateValues].sort((a, b) => b.length - a.length);
  const redact = (line) =>
    masks
      .reduce((result, value) => result.replaceAll(value, '[redacted]'), line)
      .replace(/\b[\w.!#$%&'*+/=?^_{|}~-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[email redacted]')
      .replace(/(?:postgres(?:ql)?|rediss?):\/\/[^\s"'<>]+/gi, '[connection redacted]');
  const child = spawn(process.execPath, args.slice(2), {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const [input, output] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
  ]) {
    createInterface({ input }).on('line', (line) => output.write(redact(line) + '\n'));
  }
  child.once('error', () => refuse('the guarded command could not start'));
  child.once('close', (code) => {
    process.exitCode = code ?? 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) launch();
