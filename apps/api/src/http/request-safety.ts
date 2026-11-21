import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { sendApiError } from './api-error.js';

export function requestLogger(logger: Logger): RequestHandler {
  return pinoHttp({
    logger,
    serializers: {
      req: (request) => ({ id: request.id, method: request.method }),
      res: (response) => ({ statusCode: response.statusCode }),
      err: () => ({ type: 'RequestError' }),
    },
  });
}

export function requestErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error, _request, response, next) => {
    if (response.headersSent) {
      next(new Error('Response interrupted'));
      return;
    }
    const type: unknown = error?.type;
    if (type === 'entity.parse.failed') {
      sendApiError(response, 400, 'INVALID_REQUEST', 'Request body must be valid JSON');
      return;
    }
    if (type === 'entity.too.large') {
      sendApiError(response, 413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds the size limit');
      return;
    }
    logger.error('Unhandled request error');
    sendApiError(response, 500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred');
  };
}
