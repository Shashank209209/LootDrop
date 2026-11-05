import 'dotenv/config';
import { envSchema } from './env-schema.js';

export const env = envSchema.parse(process.env);
