import type { Page } from '@playwright/test';

export const gameId = '20da2e1d-c56e-4874-8e7c-f5d15d38d502';
export const title = 'Celeste';
export const fixtureEmail = ['player', 'example.invalid'].join('@');
export const fixturePassword = ['Fixture', 'Passphrase', 'Twenty'].join('-');
const checkedAt = '2026-01-02T00:00:00.000Z';
const store = { id: 'eaaed60e-8398-4ea4-98d0-78764e786fba', name: 'Steam', slug: 'steam' };
const metadata = {
  coverUrl: null,
  genres: [{ name: 'Indie', slug: 'indie' }],
  platforms: [{ name: 'PC', slug: 'pc' }],
  releaseDate: '2018-01-25',
  metacriticScore: 91,
  userRating: 4.2,
};
const listing = {
  id: 'listing-1',
  store,
  currentPrice: 4.99,
  regularPrice: 19.99,
  discountPercent: 75,
  currency: 'USD',
  isOnSale: true,
  dealUrl: 'https://store.steampowered.com/',
  lastCheckedAt: checkedAt,
};
const deal = { ...listing, ...metadata, gameId, gameTitle: title, gameSlug: 'celeste' };
const game = { id: gameId, title, slug: 'celeste' };
const conditions = {
  game,
  store,
  alertType: 'PRICE_BELOW',
  targetPrice: 3.5,
  targetDiscountPercent: null,
  currency: 'USD',
  isActive: true,
  lastTriggeredAt: null,
  createdAt: checkedAt,
  id: '1c04c3e2-36ac-43d9-81ca-55f05dc8af6d',
  current: listing,
};
const notification = {
  id: 'notification-1',
  type: 'IN_APP',
  status: 'SENT',
  message: 'Celeste reached your price target.',
  readAt: null,
  createdAt: checkedAt,
  game,
  store,
  currency: 'USD',
  priceAtTrigger: 4.99,
};
const pagination = (page: number, count: number, totalPages = 1) => ({
  page,
  pageSize: 20,
  totalItems: count,
  totalPages,
  hasNextPage: page < totalPages,
});

export async function mockApi(
  page: Page,
  options = { authenticated: false, populated: false, error: false },
) {
  let signedIn = options.authenticated;
  let wishlisted = options.populated;
  let alert: typeof conditions | null = options.populated ? { ...conditions } : null;
  let preferredCurrency = 'USD';
  let failDeals = options.error;
  const user = { id: gameId, email: fixtureEmail, displayName: 'Demo Player' };
  const session = () => ({ user, accessToken: ['mock', 'browser', 'session'].join('-') });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.slice('/api/v1'.length);
    const method = request.method();
    const send = (json: unknown, status = 200) => route.fulfill({ status, json });
    const unauthorized = () =>
      send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
    if (path === '/auth/refresh') return signedIn ? send(session()) : unauthorized();
    if (path === '/auth/register' || path === '/auth/login') {
      signedIn = true;
      return send(session(), path.endsWith('register') ? 201 : 200);
    }
    if (path === '/auth/logout') {
      signedIn = false;
      return route.fulfill({ status: 204 });
    }
    if (path === '/auth/me')
      return signedIn ? send({ user: { ...user, preferredCurrency } }) : unauthorized();
    if (path === '/me/preferences' && method === 'PATCH') {
      preferredCurrency = request.postDataJSON().preferredCurrency;
      return send({ preferredCurrency });
    }
    if (path === '/rates')
      return send({
        base: 'USD',
        rates: { USD: 1, INR: 85, EUR: 0.9 },
        asOf: checkedAt,
        source: 'Fixture',
        stale: false,
      });
    if (path === '/stores') return send({ data: [store] });
    if (path === '/genres') return send({ data: [{ name: 'Indie', slug: 'indie', dealCount: 3 }] });
    if (path === '/platforms') return send({ data: [{ name: 'PC', slug: 'pc', dealCount: 3 }] });
    if (path === '/deals') {
      if (failDeals)
        return send(
          { error: { code: 'UNAVAILABLE', message: 'Catalog temporarily unavailable' } },
          503,
        );
      const index = Number(url.searchParams.get('page') ?? '1');
      return send({ data: [deal], pagination: pagination(index, 21, 2) });
    }
    if (path.startsWith('/deals/')) return send({ data: [] });
    if (path === '/games/search')
      return send({
        data: [{ ...game, bestPrice: 4.99, currency: 'USD', bestDiscountPercent: 75 }],
      });
    if (path === '/games/celeste')
      return send({
        data: {
          game: {
            ...game,
            ...metadata,
            description: 'A mountain adventure with a handcrafted story.',
          },
          listings: [listing],
          summary: {
            bestListingId: listing.id,
            lowestRecordedPrice: 4.99,
            highestRecordedPrice: 19.99,
            snapshotCount: 2,
          },
        },
      });
    if (path === '/games/celeste/price-history')
      return send({
        data: [
          {
            listingId: listing.id,
            currency: 'USD',
            store,
            points: [
              {
                capturedAt: '2026-01-01T00:00:00.000Z',
                price: 19.99,
                regularPrice: 19.99,
                discountPercent: null,
              },
              { capturedAt: checkedAt, price: 4.99, regularPrice: 19.99, discountPercent: 75 },
            ],
          },
        ],
        range: { from: null, to: checkedAt },
      });
    if (path === '/wishlist/ids') return send({ gameIds: wishlisted ? [gameId] : [] });
    if (path === '/wishlist' && method === 'POST') {
      wishlisted = true;
      return send({ gameId, added: true }, 201);
    }
    if (path.startsWith('/wishlist/') && method === 'DELETE') {
      wishlisted = false;
      return route.fulfill({ status: 204 });
    }
    if (path === '/wishlist')
      return send({
        data: wishlisted
          ? [
              {
                gameId,
                gameSlug: 'celeste',
                gameTitle: title,
                addedAt: checkedAt,
                bestListing: listing,
              },
            ]
          : [],
        pagination: pagination(1, Number(wishlisted)),
      });
    if (path === '/alerts' && method === 'POST') {
      alert = { ...conditions, targetPrice: request.postDataJSON().targetPrice };
      return send(alert, 201);
    }
    if (path.startsWith('/alerts/') && method === 'PATCH') {
      alert = { ...(alert ?? conditions), ...request.postDataJSON() };
      return send(alert);
    }
    if (path.startsWith('/alerts/') && method === 'DELETE') {
      alert = null;
      return route.fulfill({ status: 204 });
    }
    if (path === '/alerts')
      return send({ data: alert ? [alert] : [], pagination: pagination(1, alert ? 1 : 0) });
    if (path === '/notifications/unread-count') return send({ unreadCount: 1 });
    if (path === '/notifications')
      return send({ data: [notification], unreadCount: 1, pagination: pagination(1, 1) });
    return send({ error: { code: 'NOT_FOUND', message: 'Fixture route missing' } }, 404);
  });
  return {
    restoreDeals: () => {
      failDeals = false;
    },
  };
}
