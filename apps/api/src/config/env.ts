import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { envSchema } from './env-schema.js';

const rootEnvPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env');
if (existsSync(rootEnvPath)) config({ path: rootEnvPath });

const parsedEnv = envSchema.safeParse(process.env);
if (!parsedEnv.success) {
  const invalidNames = [
    ...new Set(
      parsedEnv.error.issues.flatMap((issue) =>
        typeof issue.path[0] === 'string' ? [issue.path[0]] : [],
      ),
    ),
  ];
  throw new Error(`Invalid environment configuration for: ${invalidNames.join(', ')}`);
}

export const env = parsedEnv.data;
