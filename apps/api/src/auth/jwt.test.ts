import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { accessTokenLifetimeSeconds, signAccessToken, verifyAccessToken } from './jwt.js';

const userId = '20da2e1d-c56e-4874-8e7c-f5d15d38d502';
const secret = 'test-secret-with-more-than-thirty-two-characters';
const issuer = 'lootdrop-test';

function signWithHeader(header: Record<string, string>, now: number): string {
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(
    JSON.stringify({
      sub: userId,
      iss: issuer,
      iat: Math.floor(now / 1000),
      exp: Math.floor(now / 1000) + accessTokenLifetimeSeconds,
    }),
  ).toString('base64url');
  const input = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret).update(input).digest('base64url');
  return `${input}.${signature}`;
}

describe('access JWT', () => {
  it('signs and verifies a 15-minute token with the expected subject and issuer', () => {
    const now = 1_800_000_000_000;
    const token = signAccessToken(userId, secret, issuer, now);

    expect(verifyAccessToken(token, secret, issuer, now)).toBe(userId);
    expect(verifyAccessToken(token, secret, issuer, now + 15 * 60 * 1000)).toBeNull();
  });

  it('rejects tampered signatures, wrong secrets, and wrong issuers', () => {
    const token = signAccessToken(userId, secret, issuer);
    const [header, payload] = token.split('.');

    expect(verifyAccessToken(`${header}.${payload}.tampered`, secret, issuer)).toBeNull();
    expect(verifyAccessToken(token, `${secret}-wrong`, issuer)).toBeNull();
    expect(verifyAccessToken(token, secret, 'another-issuer')).toBeNull();
  });

  it('rejects expired tokens and algorithms other than HS256', () => {
    const expired = signAccessToken(userId, secret, issuer, 1_000);
    expect(verifyAccessToken(expired, secret, issuer, 2_000_000)).toBeNull();

    const wrongAlgorithm = signWithHeader({ alg: 'HS384', typ: 'JWT' }, Date.now());
    expect(verifyAccessToken(wrongAlgorithm, secret, issuer)).toBeNull();
  });
});
