import type { RequestHandler } from 'express';

export function readiness(probes: Array<() => Promise<unknown>>, timeoutMs = 1000): RequestHandler {
  return async (_request, response) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all(probes.map((probe) => Promise.resolve().then(probe))),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Readiness deadline expired')), timeoutMs);
        }),
      ]);
      response.json({ status: 'ready' });
    } catch {
      response.status(503).json({ status: 'unavailable' });
    } finally {
      clearTimeout(timer);
    }
  };
}
