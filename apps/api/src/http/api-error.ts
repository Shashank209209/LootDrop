import type { Response } from 'express';

export function sendApiError(
  response: Response,
  status: number,
  code: string,
  message: string,
): void {
  response.status(status).json({
    error: { code, message, details: null },
  });
}
