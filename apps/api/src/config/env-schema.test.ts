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

    it('defaults to the credential-free log email provider', () => {
      const parsed = envSchema.parse({
        ...validEnvironment,
        JWT_ACCESS_SECRET: 'a'.repeat(32),
      });
      expect(parsed.EMAIL_PROVIDER).toBe('log');
      expect(parsed.RESEND_API_KEY).toBeUndefined();
      expect(parsed.EMAIL_FROM).toBeUndefined();
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
