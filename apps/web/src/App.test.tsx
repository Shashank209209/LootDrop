// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DealResponse, DealsResponse, StoreResponse } from '@dealhunter/contracts';
import App from './App.js';
import { getDeals, getStores } from './lib/api-client.js';

vi.mock('./lib/api-client.js', () => ({
  getDeals: vi.fn(),
  getStores: vi.fn(),
}));

const deal: DealResponse = {
  id: 'listing-1',
  gameId: 'game-1',
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

function renderDashboard(entry = '/') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user };
}

async function logIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Email address'), 'player@example.com');
  await user.type(screen.getByLabelText('Password'), 'secret1');
  await user.click(screen.getAllByRole('button', { name: 'Log in' }).at(-1)!);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDeals).mockResolvedValue(dealsResponse());
  vi.mocked(getStores).mockResolvedValue({ data: [steam] });
});

afterEach(() => cleanup());

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
});
