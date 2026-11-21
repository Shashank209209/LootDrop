import { describe, expect, it } from 'vitest';
import { dealSyncIntervalSchema, envSchema } from './env-schema.js';

describe('deal sync interval', () => {
  it('accepts 30 and 60 minutes', () => {
    expect(dealSyncIntervalSchema.parse(30)).toBe(30);
    expect(dealSyncIntervalSchema.parse(60)).toBe(60);
  });

  describe('authentication environment', () => {
    const validEnvironment = {
      DATABASE_URL: 'postgresql://localhost/test',
      REDIS_URL: 'redis://localhost:6379',
    };

    it('refuses startup configuration with a missing or short JWT secret', () => {
      expect(envSchema.safeParse(validEnvironment).success).toBe(false);
      expect(
        envSchema.safeParse({
          ...validEnvironment,
          JWT_ACCESS_SECRET: 'too-short',
        }).success,
      ).toBe(false);
      expect(
        envSchema.safeParse({
          ...validEnvironment,
          JWT_ACCESS_SECRET: 'a'.repeat(32),
        }).success,
      ).toBe(true);
    });

    it('requires Secure cookies when SameSite=None is selected', () => {
      expect(
        envSchema.safeParse({
          ...validEnvironment,
          JWT_ACCESS_SECRET: 'a'.repeat(32),
          AUTH_COOKIE_SAME_SITE: 'none',
          AUTH_COOKIE_SECURE: false,
        }).success,
      ).toBe(false);
    });

    it('requires explicit production database and HTTPS browser settings and defaults Secure on', () => {
      const production = {
        ...validEnvironment,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'test-only-strength-fixture-with-diverse-characters-012345',
      };
      const incomplete = envSchema.safeParse(production);
      expect(incomplete.success).toBe(false);
      if (!incomplete.success)
        expect(incomplete.error.issues.map(({ path }) => path[0])).toEqual([
          'WEB_ORIGIN',
          'DIRECT_URL',
        ]);
      const configured = {
        ...production,
        WEB_ORIGIN: 'https://web.example.test',
        DIRECT_URL: validEnvironment.DATABASE_URL,
      };
      expect(envSchema.parse(configured).AUTH_COOKIE_SECURE).toBe(true);
      expect(envSchema.safeParse({ ...configured, AUTH_COOKIE_SECURE: false }).success).toBe(false);
      expect(
        envSchema.safeParse({ ...configured, JWT_ACCESS_SECRET: 'x'.repeat(64) }).success,
      ).toBe(false);
    });

    it('defaults to the credential-free log email provider', () => {
      const parsed = envSchema.parse({
        ...validEnvironment,
        JWT_ACCESS_SECRET: 'a'.repeat(32),
      });
      expect(parsed.EMAIL_PROVIDER).toBe('log');
      expect(parsed.RESEND_API_KEY).toBeUndefined();
      expect(parsed.EMAIL_FROM).toBeUndefined();
    });

    it('keeps RAWG optional and applies bounded enrichment defaults', () => {
      const parsed = envSchema.parse({
        ...validEnvironment,
        JWT_ACCESS_SECRET: 'a'.repeat(32),
        RAWG_API_KEY: '',
      });
      expect(parsed.RAWG_API_KEY).toBeUndefined();
      expect(parsed.RAWG_MAX_REQUESTS_PER_RUN).toBe(30);
      expect(parsed.RAWG_ENRICH_BATCH_SIZE).toBe(15);
      expect(parsed.ENRICH_INTERVAL_MINUTES).toBe(60);
    });

    it('rejects enrichment intervals outside 30 to 240 minutes', () => {
      const base = {
        ...validEnvironment,
        JWT_ACCESS_SECRET: 'a'.repeat(32),
      };
      expect(envSchema.safeParse({ ...base, ENRICH_INTERVAL_MINUTES: 29 }).success).toBe(false);
      expect(envSchema.safeParse({ ...base, ENRICH_INTERVAL_MINUTES: 241 }).success).toBe(false);
    });

    it('requires Resend credentials only when Resend is selected', () => {
      const base = {
        ...validEnvironment,
        JWT_ACCESS_SECRET: 'a'.repeat(32),
        EMAIL_PROVIDER: 'resend',
      };
      expect(envSchema.safeParse(base).success).toBe(false);
      expect(
        envSchema.safeParse({
          ...base,
          RESEND_API_KEY: 'test-key',
          EMAIL_FROM: 'alerts@example.invalid',
        }).success,
      ).toBe(true);
    });
  });

  it('rejects intervals outside 30 to 60 minutes', () => {
    expect(dealSyncIntervalSchema.safeParse(29).success).toBe(false);
    expect(dealSyncIntervalSchema.safeParse(61).success).toBe(false);
  });
});
