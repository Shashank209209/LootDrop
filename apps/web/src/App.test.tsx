// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AuthSessionResponse,
  AlertResponse,
  AlertsResponse,
  DealResponse,
  DealsResponse,
  GameDetailResponse,
  GameSearchResponse,
  HistoricalLowsResponse,
  NotificationResponse,
  NotificationsResponse,
  PriceHistoryResponse,
  StoreResponse,
  WishlistResponse,
} from '@dealhunter/contracts';
import App from './App.js';
import {
  getBestDeals,
  getAlerts,
  getDeals,
  getFreeDeals,
  getGame,
  getMe,
  getRates,
  getHistoricalLows,
  getNotifications,
  getUnreadNotificationCount,
  getPriceHistory,
  getStores,
  getTaxonomy,
  getWishlist,
  getWishlistIds,
  login,
  logout,
  createAlert,
  deleteAlert,
  updateAlert,
  markAllNotificationsRead,
  markNotificationRead,
  registerAccount,
  addWishlistGame,
  removeWishlistGame,
  restoreSession,
  saveCurrencyPreference,
  searchGames,
} from './lib/api-client.js';

vi.mock('./lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/api-client.js')>();
  return {
    ...actual,
    getDeals: vi.fn(),
    getStores: vi.fn(),
    getTaxonomy: vi.fn(),
    getBestDeals: vi.fn(),
    getAlerts: vi.fn(),
    getFreeDeals: vi.fn(),
    getHistoricalLows: vi.fn(),
    getNotifications: vi.fn(),
    getUnreadNotificationCount: vi.fn(),
    searchGames: vi.fn(),
    getGame: vi.fn(),
    getMe: vi.fn(),
    getRates: vi.fn(),
    saveCurrencyPreference: vi.fn(),
    getPriceHistory: vi.fn(),
    restoreSession: vi.fn(),
    login: vi.fn(),
    registerAccount: vi.fn(),
    logout: vi.fn(),
    createAlert: vi.fn(),
    deleteAlert: vi.fn(),
    updateAlert: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    markNotificationRead: vi.fn(),
    getWishlist: vi.fn(),
    getWishlistIds: vi.fn(),
    addWishlistGame: vi.fn(),
    removeWishlistGame: vi.fn(),
  };
});

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const emptyMetadata = {
  coverUrl: null,
  genres: [],
  platforms: [],
  releaseDate: null,
  metacriticScore: null,
  userRating: null,
};

const deal: DealResponse = {
  ...emptyMetadata,
  id: 'listing-1',
  gameId: '20da2e1d-c56e-4874-8e7c-f5d15d38d502',
  gameTitle: 'Celeste',
  gameSlug: 'celeste',
  store: { id: 'store-1', name: 'Steam', slug: 'steam' },
  currentPrice: 9.99,
  regularPrice: 19.99,
  discountPercent: 50,
  currency: 'USD',
  isOnSale: true,
  dealUrl: 'https://example.com/deal',
  lastCheckedAt: '2025-01-01T00:00:00.000Z',
};

const steam: StoreResponse = { id: 'store-1', name: 'Steam', slug: 'steam' };
const gog: StoreResponse = { id: 'store-2', name: 'GOG', slug: 'gog' };
const session: AuthSessionResponse = {
  user: {
    id: '20da2e1d-c56e-4874-8e7c-f5d15d38d502',
    email: 'player@example.com',
    displayName: 'Player One',
  },
  accessToken: 'memory-only-test-token',
};
const wishlistResponse: WishlistResponse = {
  data: [
    {
      gameId: deal.gameId,
      gameSlug: deal.gameSlug,
      gameTitle: deal.gameTitle,
      addedAt: '2026-01-01T00:00:00.000Z',
      bestListing: {
        store: steam,
        currentPrice: 9.99,
        regularPrice: 19.99,
        discountPercent: 50,
        currency: 'USD',
        isOnSale: true,
        dealUrl: deal.dealUrl,
      },
    },
  ],
  pagination: {
    page: 1,
    pageSize: 20,
    totalItems: 1,
    totalPages: 1,
    hasNextPage: false,
  },
};

const alertRecord: AlertResponse = {
  id: 'alert-1',
  game: { id: '20da2e1d-c56e-4874-8e7c-f5d15d38d502', slug: 'celeste', title: 'Celeste' },
  store: steam,
  alertType: 'PRICE_BELOW',
  targetPrice: 3.99,
  targetDiscountPercent: null,
  currency: 'USD',
  isActive: true,
  lastTriggeredAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  current: {
    currentPrice: 4.99,
    regularPrice: 19.99,
    discountPercent: 75,
    currency: 'USD',
    store: steam,
  },
};

const alertsResponse: AlertsResponse = {
  data: [alertRecord],
  pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1, hasNextPage: false },
};

const notificationRecord: NotificationResponse = {
  id: 'notification-1',
  type: 'IN_APP',
  status: 'SENT',
  message: 'Celeste dropped to $4.99 at Steam.',
  priceAtTrigger: 4.99,
  currency: 'USD',
  readAt: null,
  createdAt: '2026-01-02T00:00:00.000Z',
  game: { slug: 'celeste', title: 'Celeste' },
  store: { name: 'Steam' },
};

const notificationsResponse: NotificationsResponse = {
  data: [notificationRecord],
  pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1, hasNextPage: false },
  unreadCount: 1,
};

const gameDetail: GameDetailResponse = {
  data: {
    game: {
      ...emptyMetadata,
      description: null,
      id: '20da2e1d-c56e-4874-8e7c-f5d15d38d502',
      slug: 'celeste',
      title: 'Celeste',
    },
    listings: [
      {
        id: 'listing-steam',
        store: steam,
        currentPrice: 4.99,
        regularPrice: 19.99,
        discountPercent: 75,
        currency: 'USD',
        isOnSale: true,
        dealUrl: 'https://example.com/steam',
        lastCheckedAt: '2026-01-02T00:00:00.000Z',
      },
      {
        id: 'listing-gog',
        store: gog,
        currentPrice: 9.99,
        regularPrice: null,
        discountPercent: null,
        currency: 'USD',
        isOnSale: false,
        dealUrl: 'https://example.com/gog',
        lastCheckedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    summary: {
      bestListingId: 'listing-steam',
      lowestRecordedPrice: 4.99,
      highestRecordedPrice: 19.99,
      snapshotCount: 2,
    },
  },
};

const searchResponse: GameSearchResponse = {
  data: [
    {
      id: '20da2e1d-c56e-4874-8e7c-f5d15d38d502',
      slug: 'celeste',
      title: 'Celeste',
      bestPrice: 4.99,
      currency: 'USD',
      bestDiscountPercent: 75,
    },
  ],
};

const priceHistory: PriceHistoryResponse = {
  data: [
    {
      listingId: 'listing-steam',
      store: steam,
      currency: 'USD',
      points: [
        {
          capturedAt: '2026-01-01T00:00:00.000Z',
          price: 9.99,
          regularPrice: 19.99,
          discountPercent: 50,
        },
        {
          capturedAt: '2026-01-02T00:00:00.000Z',
          price: 4.99,
          regularPrice: 19.99,
          discountPercent: 75,
        },
      ],
    },
  ],
  range: { from: '2025-10-04T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z' },
};

function dealsResponse(data: DealResponse[] = [deal], page = 1): DealsResponse {
  return {
    data,
    pagination: {
      page,
      pageSize: 20,
      totalItems: data.length,
      totalPages: data.length ? 1 : 0,
      hasNextPage: false,
    },
  };
}

function CurrentSearch() {
  return (
    <span data-testid="current-search" hidden>
      {useLocation().search}
    </span>
  );
}

function renderDashboard(entry = '/') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <App />
        <CurrentSearch />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user, queryClient };
}

async function logIn(user: ReturnType<typeof userEvent.setup>) {
  void user;
  await waitFor(() => expect(screen.queryByText('Restoring your session…')).toBeNull());
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.removeItem('lootdrop.currency');
  vi.mocked(getMe).mockResolvedValue({ user: { ...session.user, preferredCurrency: 'USD' } });
  vi.mocked(getRates).mockResolvedValue({
    base: 'USD',
    rates: { USD: 1, EUR: 0.9, INR: 85 },
    asOf: '2026-01-01T00:00:00.000Z',
    source: 'Frankfurter (European Central Bank)',
    stale: false,
  });
  vi.mocked(saveCurrencyPreference).mockImplementation(async (preferredCurrency) => ({
    preferredCurrency,
  }));
  vi.mocked(getDeals).mockResolvedValue(dealsResponse());
  vi.mocked(getAlerts).mockResolvedValue(alertsResponse);
  vi.mocked(getStores).mockResolvedValue({ data: [steam] });
  vi.mocked(getTaxonomy).mockResolvedValue({ data: [] });
  vi.mocked(getBestDeals).mockResolvedValue({ data: [] });
  vi.mocked(getFreeDeals).mockResolvedValue({ data: [] });
  vi.mocked(getHistoricalLows).mockResolvedValue({ data: [] });
  vi.mocked(getNotifications).mockResolvedValue(notificationsResponse);
  vi.mocked(getUnreadNotificationCount).mockResolvedValue(0);
  vi.mocked(restoreSession).mockResolvedValue(session);
  vi.mocked(login).mockResolvedValue(session);
  vi.mocked(registerAccount).mockResolvedValue(session);
  vi.mocked(logout).mockResolvedValue();
  vi.mocked(getWishlist).mockResolvedValue(wishlistResponse);
  vi.mocked(getWishlistIds).mockResolvedValue({ gameIds: [] });
  vi.mocked(addWishlistGame).mockResolvedValue({ gameId: deal.gameId, added: true });
  vi.mocked(removeWishlistGame).mockResolvedValue();
  vi.mocked(searchGames).mockResolvedValue(searchResponse);
  vi.mocked(getGame).mockResolvedValue(gameDetail);
  vi.mocked(getPriceHistory).mockResolvedValue(priceHistory);
  vi.mocked(createAlert).mockResolvedValue(alertRecord);
  vi.mocked(updateAlert).mockResolvedValue(alertRecord);
  vi.mocked(deleteAlert).mockResolvedValue();
  vi.mocked(markAllNotificationsRead).mockResolvedValue({ updated: 1 });
  vi.mocked(markNotificationRead).mockResolvedValue();
});

afterEach(() => cleanup());

describe('display currency preference', () => {
  it('tab-focuses the selector and persists the guest choice across a remount', async () => {
    vi.mocked(restoreSession).mockResolvedValue(null);
    const { user } = renderDashboard();
    const selector = await screen.findByRole<HTMLSelectElement>('combobox', { name: 'Currency' });
    screen.getByRole('combobox', { name: 'Search games' }).focus();
    await user.tab();
    expect(document.activeElement).toBe(selector);
    await user.selectOptions(selector, 'INR');
    expect(localStorage.getItem('lootdrop.currency')).toBe('INR');
    expect(saveCurrencyPreference).not.toHaveBeenCalled();
    cleanup();
    renderDashboard();
    expect(
      (await screen.findByRole<HTMLSelectElement>('combobox', { name: 'Currency' })).value,
    ).toBe('INR');
  });

  it('prefers the saved account choice on login, saves changes, and restores guest currency on logout', async () => {
    localStorage.setItem('lootdrop.currency', 'INR');
    vi.mocked(restoreSession).mockResolvedValue(null);
    vi.mocked(getMe).mockResolvedValue({ user: { ...session.user, preferredCurrency: 'EUR' } });
    const { user } = renderDashboard('/login');
    await user.type(await screen.findByLabelText('Email address'), 'player@example.com');
    await user.type(screen.getByLabelText('Password'), 'fixture-password-long-enough');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    const selector = await screen.findByRole<HTMLSelectElement>('combobox', { name: 'Currency' });
    await waitFor(() => expect(selector.value).toBe('EUR'));
    await user.selectOptions(selector, 'USD');
    await waitFor(() => expect(saveCurrencyPreference).toHaveBeenCalledWith('USD'));
    expect(localStorage.getItem('lootdrop.currency')).toBe('INR');
    expect(Object.values(localStorage)).not.toContain(session.accessToken);
    expect(Object.values(sessionStorage)).not.toContain(session.accessToken);
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    expect(
      (await screen.findByRole<HTMLSelectElement>('combobox', { name: 'Currency' })).value,
    ).toBe('INR');
  });

  it('updates the selector optimistically and rolls it back with an error when saving fails', async () => {
    let rejectSave!: (error: Error) => void;
    vi.mocked(saveCurrencyPreference).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectSave = reject;
      }),
    );
    const { user } = renderDashboard();
    const selector = await screen.findByRole<HTMLSelectElement>('combobox', { name: 'Currency' });
    await waitFor(() => expect(selector.disabled).toBe(false));
    await user.selectOptions(selector, 'EUR');
    await waitFor(() => expect(selector.value).toBe('EUR'));
    rejectSave(new Error('test server refused the preference'));
    expect(await screen.findByText('Currency preference could not be saved.')).toBeTruthy();
    expect(selector.value).toBe('USD');
  });
});

describe('live deals dashboard', () => {
  it('renders deals returned by the API', async () => {
    const { user } = renderDashboard();
    await logIn(user);

    expect(await screen.findByRole('heading', { name: 'Celeste' })).toBeTruthy();
    expect(screen.getByRole('article').textContent).toContain('Steam');
    expect(screen.getByRole('link', { name: 'View deal' }).getAttribute('href')).toBe(
      'https://example.com/deal',
    );
  });

  it('shows a loading state while the deals request is pending', async () => {
    vi.mocked(getDeals).mockReturnValue(new Promise(() => {}));
    const { user } = renderDashboard();
    await logIn(user);

    expect(await screen.findByLabelText('Loading deals')).toBeTruthy();
  });

  it('shows an empty state and reset action when no deals match', async () => {
    vi.mocked(getDeals).mockResolvedValue(dealsResponse([], 1));
    const { user } = renderDashboard('/?q=missing');
    await logIn(user);

    expect(await screen.findByText('No deals match your filters.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reset filters' })).toBeTruthy();
  });

  it('shows an error and retries the failed request', async () => {
    vi.mocked(getDeals)
      .mockRejectedValueOnce(new Error('API unavailable'))
      .mockResolvedValueOnce(dealsResponse());
    const { user } = renderDashboard();
    await logIn(user);

    expect((await screen.findByRole('alert')).textContent).toContain('API unavailable');
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('heading', { name: 'Celeste' })).toBeTruthy();
    expect(getDeals).toHaveBeenCalledTimes(2);
  });

  it('updates the request and resets the page when a filter changes', async () => {
    const { user } = renderDashboard('/?page=3');
    await logIn(user);
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Store' }), 'steam');

    await waitFor(() =>
      expect(getDeals).toHaveBeenLastCalledWith(
        expect.objectContaining({ store: 'steam', page: 1 }),
        expect.anything(),
      ),
    );
  });

  it('keeps multiple genres and platforms in the request and the URL and resets the page', async () => {
    vi.mocked(getTaxonomy).mockImplementation(async (kind) => ({
      data:
        kind === 'genres'
          ? [
              { slug: 'indie', name: 'Indie', dealCount: 3 },
              { slug: 'action', name: 'Action', dealCount: 2 },
            ]
          : [{ slug: 'pc', name: 'PC', dealCount: 5 }],
    }));
    const { user } = renderDashboard('/?page=3&store=steam');
    await user.click(await screen.findByRole('checkbox', { name: 'Indie, 3 games on sale' }));
    await user.click(screen.getByRole('checkbox', { name: 'Action, 2 games on sale' }));
    await user.click(await screen.findByRole('checkbox', { name: 'PC, 5 games on sale' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort deals' }), 'rating_desc');
    await waitFor(() =>
      expect(getDeals).toHaveBeenLastCalledWith(
        expect.objectContaining({
          genre: ['indie', 'action'],
          platform: ['pc'],
          page: 1,
          store: 'steam',
          sort: 'rating_desc',
        }),
        expect.anything(),
      ),
    );
    const params = new URLSearchParams(screen.getByTestId('current-search').textContent ?? '');
    expect(params.getAll('genre')).toEqual(['indie', 'action']);
    expect(params.getAll('platform')).toEqual(['pc']);
    expect(params.get('page')).toBeNull();
  });

  it('restores taxonomy selections from comma-separated and repeated URL parameters', async () => {
    vi.mocked(getTaxonomy).mockImplementation(async (kind) => ({
      data:
        kind === 'genres'
          ? [
              { slug: 'indie', name: 'Indie', dealCount: 3 },
              { slug: 'action', name: 'Action', dealCount: 2 },
            ]
          : [
              { slug: 'pc', name: 'PC', dealCount: 5 },
              { slug: 'linux', name: 'Linux', dealCount: 1 },
            ],
    }));
    renderDashboard('/?genre=indie,action&platform=pc&platform=linux&page=2');
    await waitFor(() => expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(4));
    expect(getDeals).toHaveBeenCalledWith(
      expect.objectContaining({ genre: ['indie', 'action'], platform: ['pc', 'linux'], page: 2 }),
      expect.anything(),
    );
  });

  it('hides an empty genre section and renders deals with missing metadata safely', async () => {
    vi.mocked(getTaxonomy).mockImplementation(async (kind) => ({
      data: kind === 'platforms' ? [{ slug: 'pc', name: 'PC', dealCount: 5 }] : [],
    }));
    renderDashboard();
    expect(await screen.findByRole('group', { name: 'Platforms' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Genres' })).toBeNull();
    const card = await screen.findByRole('article');
    expect(within(card).getByText('C')).toBeTruthy();
    expect(within(card).queryByRole('list', { name: 'Genres' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Game metadata by RAWG' }).getAttribute('href')).toBe(
      'https://rawg.io/',
    );
  });

  it('shows deal metadata and falls back if the cover fails to load', async () => {
    vi.mocked(getDeals).mockResolvedValue(
      dealsResponse([
        {
          ...deal,
          coverUrl: 'https://example.com/cover.jpg',
          releaseDate: '2018-01-25',
          userRating: 4.2,
          genres: [{ name: 'Indie', slug: 'indie' }],
        },
      ]),
    );
    renderDashboard();
    const cover = await screen.findByRole('img', { name: 'Celeste' });
    expect(cover.getAttribute('loading')).toBe('lazy');
    expect(cover.getAttribute('width')).toBe('92');
    expect(cover.getAttribute('height')).toBe('92');
    expect(screen.getByText('RAWG 4.2/5')).toBeTruthy();
    expect(screen.getByText('Indie')).toBeTruthy();
    expect(screen.getByText('2018')).toBeTruthy();
    fireEvent.error(cover);
    expect(screen.queryByRole('img', { name: 'Celeste' })).toBeNull();
    expect(within(screen.getByRole('article')).getByText('C')).toBeTruthy();
  });

  it('debounces search and resets to page one', async () => {
    const { user } = renderDashboard('/?page=3');
    await logIn(user);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search deals' }), {
      target: { value: 'Celeste' },
    });

    await waitFor(() =>
      expect(getDeals).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: 'Celeste', page: 1 }),
        expect.anything(),
      ),
    );
  });

  it('restores filters from the URL', async () => {
    const { user } = renderDashboard(
      '/?q=Celeste&store=steam&minPrice=5&sort=price_asc&page=2&onSale=false',
    );
    await logIn(user);

    expect((screen.getByRole('textbox', { name: 'Search deals' }) as HTMLInputElement).value).toBe(
      'Celeste',
    );
    await screen.findByRole('option', { name: 'Steam' });
    expect((screen.getByRole('combobox', { name: 'Store' }) as HTMLSelectElement).value).toBe(
      'steam',
    );
    await waitFor(() =>
      expect(getDeals).toHaveBeenCalledWith(
        expect.objectContaining({
          q: 'Celeste',
          store: 'steam',
          minPrice: 5,
          sort: 'price_asc',
          page: 2,
          onSale: false,
        }),
        expect.anything(),
      ),
    );
  });

  it('debounces autocomplete, supports arrows and Enter, and opens a game page', async () => {
    const { user } = renderDashboard();
    await logIn(user);
    const search = screen.getByRole('combobox', { name: 'Search games' });
    await user.type(search, 'ce');

    expect(await screen.findByRole('option', { name: /Celeste/ })).toBeTruthy();
    expect(searchGames).toHaveBeenLastCalledWith('ce', expect.anything());
    await user.keyboard('{ArrowDown}{Enter}');

    expect(await screen.findByRole('heading', { name: 'Celeste' })).toBeTruthy();
    expect(getGame).toHaveBeenCalledWith('celeste', expect.anything());
  });

  it('shows no-results text and closes autocomplete with Escape', async () => {
    vi.mocked(searchGames).mockResolvedValue({ data: [] });
    const { user } = renderDashboard();
    await logIn(user);
    const search = screen.getByRole('combobox', { name: 'Search games' });
    await user.type(search, 'zz');

    expect(await screen.findByText('No games found.')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('does not replace newer autocomplete results with a stale response', async () => {
    let resolveOld!: (result: GameSearchResponse) => void;
    const oldRequest = new Promise<GameSearchResponse>((resolve) => {
      resolveOld = resolve;
    });
    const newerResult: GameSearchResponse = {
      data: [{ ...searchResponse.data[0]!, id: 'game-2', slug: 'celeste-2', title: 'Celeste 2' }],
    };
    vi.mocked(searchGames).mockImplementation((query) =>
      query === 'ce' ? oldRequest : Promise.resolve(newerResult),
    );
    const { user } = renderDashboard();
    await logIn(user);
    const search = screen.getByRole('combobox', { name: 'Search games' });
    fireEvent.change(search, { target: { value: 'ce' } });
    await waitFor(() => expect(searchGames).toHaveBeenCalledWith('ce', expect.anything()));
    fireEvent.change(search, { target: { value: 'cel' } });

    expect(await screen.findByRole('option', { name: /Celeste 2/ })).toBeTruthy();
    resolveOld(searchResponse);
    await waitFor(() => expect(screen.queryByRole('option', { name: /^Celeste$/ })).toBeNull());
    expect(screen.getByRole('option', { name: /Celeste 2/ })).toBeTruthy();
  });

  it('renders game details, highlights the cheapest listing, and sorts the store table', async () => {
    const { user } = renderDashboard('/games/celeste');
    await logIn(user);

    expect(await screen.findByRole('heading', { name: 'Celeste' })).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Store comparison' });
    const rows = table.querySelectorAll('tbody tr');
    expect(rows[0]?.textContent).toContain('Steam');
    expect(rows[0]?.className).toContain('cheapest-listing');
    expect(table.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer');

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Sort store listings' }),
      'store',
    );
    await waitFor(() => {
      expect(table.querySelector('tbody tr')?.textContent).toContain('GOG');
    });
    expect(await screen.findByTestId('price-chart-USD')).toBeTruthy();
  });

  it('shows an explicit not-found page for an unknown game slug', async () => {
    const { ApiError } = await import('./lib/api-client.js');
    vi.mocked(getGame).mockRejectedValue(new ApiError('Game not found', 404, 'NOT_FOUND'));
    const { user } = renderDashboard('/games/missing');
    await logIn(user);

    expect(await screen.findByRole('heading', { name: 'Game not found' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to deals' })).toBeTruthy();
  });

  it('uses the selected range for history queries', async () => {
    const { user } = renderDashboard('/games/celeste');
    await logIn(user);
    await screen.findByRole('heading', { name: 'Celeste' });
    await user.click(screen.getByRole('button', { name: '30d' }));

    await waitFor(() =>
      expect(getPriceHistory).toHaveBeenLastCalledWith(
        'celeste',
        { range: '30d' },
        expect.anything(),
      ),
    );
    expect(screen.getByRole('button', { name: '30d' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows curated sections when populated, hides empty sections and reports errors', async () => {
    vi.mocked(getBestDeals).mockResolvedValue({ data: [deal] });
    vi.mocked(getFreeDeals).mockResolvedValue({ data: [deal] });
    const historical: HistoricalLowsResponse = {
      data: [{ ...deal, lowestRecordedPrice: 4.99 }],
    };
    vi.mocked(getHistoricalLows).mockResolvedValue(historical);
    const { user } = renderDashboard();
    await logIn(user);

    expect(await screen.findByRole('region', { name: 'Best deals' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Free games' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Historical lows' })).toBeTruthy();

    cleanup();
    vi.clearAllMocks();
    vi.mocked(getDeals).mockRejectedValue(new Error('API unavailable'));
    vi.mocked(getStores).mockResolvedValue({ data: [] });
    vi.mocked(getBestDeals).mockRejectedValue(new Error('Best deals unavailable'));
    vi.mocked(getFreeDeals).mockResolvedValue({ data: [] });
    vi.mocked(getHistoricalLows).mockResolvedValue({ data: [] });
    const second = renderDashboard();
    await logIn(second.user);

    const alertWithBestError = await waitFor(() =>
      screen
        .getAllByRole('alert')
        .find((item) => item.textContent?.includes('Best deals unavailable')),
    );
    expect(alertWithBestError).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Free games' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Celeste' })).toBeNull();
  });
});

describe('game metadata', () => {
  it('renders the release date and taxonomy and expands the description as plain text', async () => {
    const markup = '<em data-embedded>Literal markup</em>';
    const description = 'A long description. '.repeat(22) + markup;
    vi.mocked(getGame).mockResolvedValue({
      data: {
        ...gameDetail.data,
        game: {
          ...gameDetail.data.game,
          description,
          coverUrl: 'https://example.com/cover.jpg',
          releaseDate: '2018-01-25',
          metacriticScore: 91,
          userRating: 4.2,
          genres: [{ name: 'Indie', slug: 'indie' }],
          platforms: [{ name: 'PC', slug: 'pc' }],
        },
      },
    });
    const { user } = renderDashboard('/games/celeste');
    const metadata = await screen.findByRole('region', { name: 'Game metadata' });
    expect(within(metadata).getByText('Indie')).toBeTruthy();
    expect(within(metadata).getByText('PC')).toBeTruthy();
    expect(metadata.querySelector('time')?.getAttribute('datetime')).toBe('2018-01-25');
    expect(within(metadata).getByText('RAWG rating 4.2/5')).toBeTruthy();
    expect(within(metadata).getByText('Metacritic 91/100')).toBeTruthy();
    expect(within(metadata).getByRole('link', { name: 'Game metadata by RAWG' })).toBeTruthy();
    const toggle = within(metadata).getByRole('button', { name: 'Read more' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(metadata.textContent).not.toContain(markup);
    await user.click(toggle);
    expect(metadata.textContent).toContain(markup);
    expect(metadata.querySelector('[data-embedded]')).toBeNull();
    await user.click(within(metadata).getByRole('button', { name: 'Read less' }));
    expect(metadata.textContent).not.toContain(markup);
  });

  it('keeps the detail usable with null metadata', async () => {
    renderDashboard('/games/celeste');
    expect(await screen.findByRole('heading', { name: 'Celeste' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Celeste' })).toBeNull();
    const metadata = screen.getByRole('region', { name: 'Game metadata' });
    expect(within(metadata).queryByRole('list')).toBeNull();
    expect(within(metadata).queryByRole('button', { name: 'Read more' })).toBeNull();
    expect(within(metadata).getByRole('link', { name: 'Game metadata by RAWG' })).toBeTruthy();
  });
});

describe('real authentication and wishlist UI', () => {
  it('shows alert type fields, validates a target, submits successfully, and restores focus on Escape', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderDashboard('/games/celeste');
    await screen.findByRole('heading', { name: 'Celeste' });
    const trigger = screen.getByRole('button', { name: 'Set alert' });
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Celeste' });
    expect(screen.getByLabelText('Target price (USD)')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Set alert' }));
    expect(await screen.findByText(/Enter a price greater than zero/)).toBeTruthy();

    await user.click(screen.getByRole('radio', { name: 'Discount reaches' }));
    expect(screen.getByLabelText('Target discount (%)')).toBeTruthy();
    expect(screen.queryByLabelText('Target price (USD)')).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Any sale starts' }));
    expect(screen.queryByLabelText('Target discount (%)')).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'New all-time low' }));
    await user.click(screen.getByRole('radio', { name: 'Price drops below' }));
    await user.type(screen.getByLabelText('Target price (USD)'), '5.00');
    expect(screen.getByText(/already met at the current price/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Set alert' }));

    await waitFor(() =>
      expect(createAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          gameId: '20da2e1d-c56e-4874-8e7c-f5d15d38d502',
          alertType: 'PRICE_BELOW',
          targetPrice: 5,
        }),
        expect.anything(),
      ),
    );
    expect((await screen.findByRole('status')).textContent).toContain('Alert saved successfully.');
    expect(queryClient.getQueryCache().findAll({ queryKey: ['alerts'] })).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('shows server errors in the alert dialog', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('./lib/api-client.js');
    vi.mocked(createAlert).mockRejectedValueOnce(new ApiError('Duplicate', 409, 'DUPLICATE_ALERT'));
    renderDashboard('/games/celeste');
    await screen.findByRole('heading', { name: 'Celeste' });
    await user.click(screen.getByRole('button', { name: 'Set alert' }));
    const dialog = await screen.findByRole('dialog', { name: 'Celeste' });
    await user.type(within(dialog).getByLabelText('Target price (USD)'), '3.50');
    await user.click(within(dialog).getByRole('button', { name: 'Set alert' }));
    expect((await screen.findByRole('alert')).textContent).toContain('This alert already exists.');
  });

  it('redirects a logged-out alert request to login and returns to the game', async () => {
    const user = userEvent.setup();
    vi.mocked(restoreSession).mockResolvedValue(null);
    renderDashboard('/games/celeste');
    await screen.findByRole('heading', { name: 'Celeste' });
    await user.click(screen.getByRole('button', { name: 'Set alert' }));
    await screen.findByLabelText('Email address');
    await user.type(screen.getByLabelText('Email address'), 'player@example.com');
    await user.type(screen.getByLabelText('Password'), 'valid-login-password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('heading', { name: 'Celeste' })).toBeTruthy();
  });

  it('shows alert loading, empty and error states', async () => {
    let resolveAlerts!: (value: AlertsResponse) => void;
    vi.mocked(getAlerts).mockReturnValue(
      new Promise((resolve) => {
        resolveAlerts = resolve;
      }),
    );
    renderDashboard('/alerts');
    await screen.findByRole('heading', { name: 'Price alerts' });
    expect(screen.getByRole('status').textContent).toContain('Loading your alerts');
    resolveAlerts({
      ...alertsResponse,
      data: [],
      pagination: { ...alertsResponse.pagination, totalItems: 0, totalPages: 0 },
    });
    expect(await screen.findByText('You have no price alerts yet.')).toBeTruthy();

    cleanup();
    vi.mocked(getAlerts).mockRejectedValueOnce(new Error('offline'));
    renderDashboard('/alerts');
    expect((await screen.findByRole('alert')).textContent).toContain('could not be loaded');
  });

  it('pauses, resumes, edits and deletes alerts with confirmation', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    let active = true;
    let exists = true;
    vi.mocked(getAlerts).mockImplementation(async () => ({
      ...alertsResponse,
      data: exists ? [{ ...alertRecord, isActive: active }] : [],
      pagination: {
        ...alertsResponse.pagination,
        totalItems: exists ? 1 : 0,
        totalPages: exists ? 1 : 0,
      },
    }));
    vi.mocked(updateAlert).mockImplementation(async (_id, update) => {
      if (update.isActive !== undefined) active = update.isActive;
      return { ...alertRecord, ...update };
    });
    vi.mocked(deleteAlert).mockImplementation(async () => {
      exists = false;
    });
    renderDashboard('/alerts');
    await screen.findByText('Below $3.99 at Steam');
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(updateAlert).toHaveBeenCalledWith('alert-1', { isActive: false });
    await user.click(await screen.findByRole('button', { name: 'Resume' }));
    expect(updateAlert).toHaveBeenCalledWith('alert-1', { isActive: true });

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.clear(await screen.findByLabelText('Target price (USD)'));
    await user.type(screen.getByLabelText('Target price (USD)'), '2.99');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(updateAlert).toHaveBeenCalledWith('alert-1', { targetPrice: 2.99 });

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(confirm).toHaveBeenCalled();
    expect(deleteAlert).toHaveBeenCalledWith('alert-1', expect.anything());
    await waitFor(() => expect(screen.getByText('You have no price alerts yet.')).toBeTruthy());
    confirm.mockRestore();
  });

  it('rolls back an optimistic pause when the server update fails', async () => {
    const user = userEvent.setup();
    vi.mocked(updateAlert).mockRejectedValueOnce(new Error('offline'));
    renderDashboard('/alerts');
    await user.click(await screen.findByRole('button', { name: 'Pause' }));
    expect((await screen.findByRole('alert')).textContent).toContain('previous state was restored');
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  });

  it('shows notification badge, marks one and all read, and skips logged-out polling', async () => {
    const user = userEvent.setup();
    vi.mocked(getUnreadNotificationCount).mockResolvedValue(3);
    renderDashboard('/');
    const bell = await screen.findByRole('button', {
      name: 'Notifications, 3 unread notifications',
    });
    await user.click(bell);
    expect(await screen.findByText('Celeste dropped to $4.99 at Steam.')).toBeTruthy();
    await user.click(screen.getByRole('link', { name: /Celeste dropped to/ }));
    expect(markNotificationRead).toHaveBeenCalledWith('notification-1', expect.anything());

    await user.click(await screen.findByRole('button', { name: /Notifications/ }));
    await user.click(await screen.findByRole('button', { name: 'Mark all as read' }));
    expect(markAllNotificationsRead).toHaveBeenCalled();
    expect(
      await screen.findByRole('button', { name: 'Notifications, 0 unread notifications' }),
    ).toBeTruthy();

    cleanup();
    vi.clearAllMocks();
    vi.mocked(restoreSession).mockResolvedValue(null);
    renderDashboard('/');
    await screen.findByRole('heading', { name: 'Discover game deals' });
    expect(getUnreadNotificationCount).not.toHaveBeenCalled();
  });

  it('keeps a neutral loading state until session restoration finishes', async () => {
    let resolveRestore!: (value: AuthSessionResponse | null) => void;
    vi.mocked(restoreSession).mockReturnValue(
      new Promise((resolve) => {
        resolveRestore = resolve;
      }),
    );
    renderDashboard();
    expect(screen.getByRole('status').textContent).toContain('Restoring your session');
    expect(screen.queryByRole('link', { name: 'Log in' })).toBeNull();

    resolveRestore(null);
    expect(await screen.findByRole('heading', { name: 'Discover game deals' })).toBeTruthy();
  });

  it('restores a logged-in user and shows an anonymous dashboard after refresh failure', async () => {
    renderDashboard();
    expect(await screen.findByRole('heading', { name: 'Welcome back, Player One' })).toBeTruthy();
    expect(restoreSession).toHaveBeenCalledTimes(1);

    cleanup();
    vi.mocked(restoreSession).mockResolvedValue(null);
    renderDashboard();
    expect(await screen.findByRole('heading', { name: 'Discover game deals' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Log in' })).toBeTruthy();
  });

  it('logs in successfully and shows a generic error for invalid credentials', async () => {
    const user = userEvent.setup();
    vi.mocked(restoreSession).mockResolvedValue(null);
    renderDashboard('/login');
    await screen.findByLabelText('Email address');
    await user.type(screen.getByLabelText('Email address'), 'player@example.com');
    await user.type(screen.getByLabelText('Password'), 'incorrect-password-123');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('heading', { name: 'Welcome back, Player One' })).toBeTruthy();
    expect(login).toHaveBeenCalledWith({
      email: 'player@example.com',
      password: 'incorrect-password-123',
    });

    cleanup();
    vi.mocked(restoreSession).mockResolvedValue(null);
    const { ApiError } = await import('./lib/api-client.js');
    vi.mocked(login).mockRejectedValueOnce(
      new ApiError('private detail', 401, 'INVALID_CREDENTIALS'),
    );
    renderDashboard('/login');
    await screen.findByLabelText('Email address');
    await user.type(screen.getByLabelText('Email address'), 'wrong@example.com');
    await user.type(screen.getByLabelText('Password'), 'incorrect-password-123');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Invalid email or password');
    expect(screen.queryByText('private detail')).toBeNull();
  });

  it('registers a normalized account and authenticates the new user', async () => {
    const user = userEvent.setup();
    vi.mocked(restoreSession).mockResolvedValue(null);
    renderDashboard('/register');
    await screen.findByLabelText('Display name');
    await user.type(screen.getByLabelText('Display name'), '  Player One  ');
    await user.type(screen.getByLabelText('Email address'), 'PLAYER@example.com');
    await user.type(screen.getByLabelText('Password'), 'valid-registration-password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: 'Welcome back, Player One' })).toBeTruthy();
    expect(registerAccount).toHaveBeenCalledWith({
      displayName: 'Player One',
      email: 'player@example.com',
      password: 'valid-registration-password',
    });
  });

  it('validates registration fields and displays a generic server conflict', async () => {
    const user = userEvent.setup();
    vi.mocked(restoreSession).mockResolvedValue(null);
    const { ApiError } = await import('./lib/api-client.js');
    vi.mocked(registerAccount).mockRejectedValueOnce(
      new ApiError('Unable to register with these details', 409, 'REGISTRATION_UNAVAILABLE'),
    );
    renderDashboard('/register');
    await screen.findByLabelText('Display name');

    await user.type(screen.getByLabelText('Display name'), '   ');
    await user.type(screen.getByLabelText('Email address'), 'invalid');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/String must contain at least 12 character/)).toBeTruthy();
    expect(screen.getByLabelText(/Display name/).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText(/Email address/).getAttribute('aria-invalid')).toBe('true');
    expect(registerAccount).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText(/Display name/));
    await user.type(screen.getByLabelText(/Display name/), 'Player');
    await user.clear(screen.getByLabelText(/Email address/));
    await user.type(screen.getByLabelText(/Email address/), 'player@example.com');
    await user.clear(screen.getByLabelText(/Password/));
    await user.type(screen.getByLabelText(/Password/), 'valid-registration-password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Unable to register with these details.',
    );
  });

  it('redirects protected wishlist access to login and returns after successful login', async () => {
    const user = userEvent.setup();
    vi.mocked(restoreSession).mockResolvedValue(null);
    renderDashboard('/wishlist?page=2');
    await screen.findByLabelText('Email address');

    await user.type(screen.getByLabelText('Email address'), 'player@example.com');
    await user.type(screen.getByLabelText('Password'), 'valid-login-password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('heading', { name: 'My wishlist' })).toBeTruthy();
    expect(getWishlist).toHaveBeenCalledWith(2, 20, expect.anything());
  });

  it('optimistically toggles a heart and rolls it back when the API fails', async () => {
    const user = userEvent.setup();
    let rejectAdd!: (error: Error) => void;
    vi.mocked(addWishlistGame).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectAdd = reject;
      }),
    );
    const { queryClient } = renderDashboard();
    await screen.findByRole('heading', { name: 'Celeste' });
    await waitFor(() =>
      expect(queryClient.getQueryData(['wishlist', 'ids'])).toEqual({ gameIds: [] }),
    );
    const heart = await screen.findByRole('button', { name: 'Add to wishlist' });
    await user.click(heart);
    await waitFor(() => expect(heart.getAttribute('aria-pressed')).toBe('true'));
    rejectAdd(new Error('request failed'));
    expect((await screen.findByRole('alert')).textContent).toContain('Wishlist update failed');
    await waitFor(() => expect(heart.getAttribute('aria-pressed')).toBe('false'));
  });

  it('sends a logged-out user to login when a wishlist heart is clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(restoreSession).mockResolvedValue(null);
    renderDashboard();
    await screen.findByRole('heading', { name: 'Celeste' });
    await user.click(await screen.findByRole('button', { name: 'Add to wishlist' }));

    expect(await screen.findByLabelText('Email address')).toBeTruthy();
    expect(login).not.toHaveBeenCalled();
  });

  it('shows wishlist entries and removes them', async () => {
    const user = userEvent.setup();
    vi.mocked(getWishlistIds).mockResolvedValueOnce({ gameIds: [deal.gameId] });
    vi.mocked(removeWishlistGame).mockImplementationOnce(async () => {
      vi.mocked(getWishlist).mockResolvedValueOnce({
        ...wishlistResponse,
        data: [],
        pagination: { ...wishlistResponse.pagination, totalItems: 0, totalPages: 0 },
      });
    });
    renderDashboard('/wishlist');
    expect(await screen.findByRole('heading', { name: 'Celeste' })).toBeTruthy();
    await screen.findByRole('button', { name: /Remove from wishlist/ });
    expect(screen.getByText('$9.99')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Remove from wishlist/ }));
    expect(removeWishlistGame).toHaveBeenCalledWith(deal.gameId);
    expect(await screen.findByText('Your wishlist is empty.')).toBeTruthy();
  });

  it('shows wishlist loading, empty, and retryable error states', async () => {
    let resolveWishlist!: (value: WishlistResponse) => void;
    vi.mocked(getWishlist).mockReturnValue(
      new Promise((resolve) => {
        resolveWishlist = resolve;
      }),
    );
    renderDashboard('/wishlist');
    await screen.findByRole('heading', { name: 'My wishlist' });
    expect(screen.getByRole('status').textContent).toContain('Loading your wishlist');
    resolveWishlist({
      ...wishlistResponse,
      data: [],
      pagination: { ...wishlistResponse.pagination, totalItems: 0, totalPages: 0 },
    });
    expect(await screen.findByText('Your wishlist is empty.')).toBeTruthy();

    cleanup();
    vi.mocked(getWishlist)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(wishlistResponse);
    const user = userEvent.setup();
    renderDashboard('/wishlist');
    expect((await screen.findByRole('alert')).textContent).toContain('could not be loaded');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Celeste' })).toBeTruthy();
  });

  it('clears the access session and all cached user data on logout', async () => {
    const user = userEvent.setup();
    const rendered = renderDashboard();
    await screen.findByRole('heading', { name: 'Celeste' });
    await waitFor(() =>
      expect(rendered.queryClient.getQueryData(['wishlist', 'ids'])).toEqual({ gameIds: [] }),
    );
    await user.click(screen.getByRole('button', { name: 'Log out' }));

    await waitFor(() =>
      expect(rendered.queryClient.getQueryData(['wishlist', 'ids'])).toBeUndefined(),
    );
    expect(await screen.findByRole('link', { name: 'Log in' })).toBeTruthy();
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
