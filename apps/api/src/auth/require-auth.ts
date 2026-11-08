import type { RequestHandler } from 'express';
import { verifyAccessToken } from './jwt.js';

export function createRequireAuth(secret: string, issuer: string): RequestHandler {
  return (request, response, next) => {
    const authorization = request.headers.authorization;
    const match =
      typeof authorization === 'string' ? /^Bearer ([^\s]+)$/.exec(authorization) : null;
    const userId = match ? verifyAccessToken(match[1]!, secret, issuer) : null;
    if (!userId) {
      response.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Authentication required', details: null },
      });
      return;
    }

    response.locals.userId = userId;
    next();
  };
}
