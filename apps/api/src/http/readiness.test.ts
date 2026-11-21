import express from 'express';
import { expect, it, vi } from 'vitest';
import { readiness } from './readiness.js';

it.each([200, 503])('returns a sanitized %s for dependency readiness', async (status) => {
  const db = vi.fn(async () => true);
  const redis = vi.fn(() => (status === 200 ? Promise.resolve('PONG') : new Promise(() => {})));
  const app = express();
  app.get('/health/ready', readiness([db, redis], 20));
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No local server');
    const response = await fetch('http://127.0.0.1:' + address.port + '/health/ready');
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ status: status === 200 ? 'ready' : 'unavailable' });
    expect(db).toHaveBeenCalledOnce();
    expect(redis).toHaveBeenCalledOnce();
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
