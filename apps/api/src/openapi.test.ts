import { describe, expect, it } from 'vitest';
import { createOpenApiDocument } from './openapi.js';

describe('OpenAPI document', () => {
  it('documents every API route', () => {
    const document = createOpenApiDocument();

    expect(Object.keys(document.paths ?? {}).sort()).toEqual(
      [
        '/api/v1/auth/login',
        '/api/v1/auth/logout',
        '/api/v1/auth/me',
        '/api/v1/auth/refresh',
        '/api/v1/auth/register',
        '/api/v1/alerts',
        '/api/v1/alerts/{alertId}',
        '/api/v1/notifications',
        '/api/v1/notifications/read-all',
        '/api/v1/notifications/unread-count',
        '/api/v1/notifications/{notificationId}/read',
        '/api/v1/deals',
        '/api/v1/deals/best',
        '/api/v1/deals/free',
        '/api/v1/deals/historical-lows',
        '/api/v1/games/search',
        '/api/v1/games/{slug}',
        '/api/v1/games/{slug}/price-history',
        '/api/v1/health',
        '/api/v1/stores',
        '/api/v1/wishlist',
        '/api/v1/wishlist/ids',
        '/api/v1/wishlist/{gameId}',
      ].sort(),
    );
    expect(document.paths?.['/api/v1/games/search']?.get?.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'q', in: 'query', required: true })]),
    );
    expect(document.paths?.['/api/v1/deals/best']?.get?.description).toContain(
      'regular price of at least 5',
    );
  });
});
