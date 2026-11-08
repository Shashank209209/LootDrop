import { createHmac, timingSafeEqual } from 'node:crypto';

const accessTokenLifetimeSeconds = 15 * 60;

type JwtHeader = { alg: string; typ?: string };
type JwtClaims = { sub: string; iss: string; iat: number; exp: number };

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signature(input: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(input).digest();
}

export function signAccessToken(
  userId: string,
  secret: string,
  issuer: string,
  now = Date.now(),
): string {
  const issuedAt = Math.floor(now / 1000);
  const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
  const payload = encodeJson({
    sub: userId,
    iss: issuer,
    iat: issuedAt,
    exp: issuedAt + accessTokenLifetimeSeconds,
  });
  const input = `${header}.${payload}`;
  return `${input}.${signature(input, secret).toString('base64url')}`;
}

function decodeJson<T>(value: string): T | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

export function verifyAccessToken(
  token: string,
  secret: string,
  issuer: string,
  now = Date.now(),
): string | null {
  const segments = token.split('.');
  if (segments.length !== 3) return null;
  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  if (!encodedHeader || !encodedPayload || !encodedSignature) return null;

  const header = decodeJson<JwtHeader>(encodedHeader);
  if (!header || header.alg !== 'HS256' || (header.typ !== undefined && header.typ !== 'JWT')) {
    return null;
  }

  const suppliedSignature = Buffer.from(encodedSignature, 'base64url');
  const expectedSignature = signature(`${encodedHeader}.${encodedPayload}`, secret);
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    return null;
  }

  const claims = decodeJson<JwtClaims>(encodedPayload);
  const nowSeconds = Math.floor(now / 1000);
  if (
    !claims ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(claims.sub) ||
    claims.iss !== issuer ||
    !Number.isInteger(claims.iat) ||
    !Number.isInteger(claims.exp) ||
    claims.iat > nowSeconds ||
    claims.exp <= nowSeconds
  ) {
    return null;
  }

  return claims.sub;
}

export { accessTokenLifetimeSeconds };
