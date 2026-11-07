import type {
  CuratedDealsResponse,
  DealResponse,
  DealsQuery,
  DealsResponse,
  GameDetailResponse,
  GameSearchResponse,
  HistoricalLowsResponse,
  PriceHistoryQuery,
  PriceHistoryResponse,
  StoreResponse,
} from '@dealhunter/contracts';

export type DealQueryParams = Partial<
  Pick<
    DealsQuery,
    'q' | 'onSale' | 'minPrice' | 'maxPrice' | 'minDiscount' | 'sort' | 'page' | 'pageSize'
  >
> & { store?: string | string[] };

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function queryString(query: DealQueryParams): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, signal ? { signal } : {});
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new ApiError(
      body?.error?.message ?? `Request failed with status ${response.status}`,
      response.status,
      body?.error?.code ?? null,
    );
  }
  return (await response.json()) as T;
}

export function getDeals(query: DealQueryParams, signal?: AbortSignal): Promise<DealsResponse> {
  const search = queryString(query);
  return getJson(`/deals${search ? `?${search}` : ''}`, signal);
}

export function getStores(signal?: AbortSignal): Promise<{ data: StoreResponse[] }> {
  return getJson('/stores', signal);
}

export function searchGames(q: string, signal?: AbortSignal): Promise<GameSearchResponse> {
  return getJson(`/games/search?${new URLSearchParams({ q })}`, signal);
}

export function getGame(slug: string, signal?: AbortSignal): Promise<GameDetailResponse> {
  return getJson(`/games/${encodeURIComponent(slug)}`, signal);
}

export function getPriceHistory(
  slug: string,
  query: PriceHistoryQuery,
  signal?: AbortSignal,
): Promise<PriceHistoryResponse> {
  const params = new URLSearchParams({ range: query.range });
  if (query.store) params.set('store', query.store);
  return getJson(`/games/${encodeURIComponent(slug)}/price-history?${params}`, signal);
}

export function getBestDeals(signal?: AbortSignal): Promise<CuratedDealsResponse> {
  return getJson('/deals/best', signal);
}

export function getFreeDeals(signal?: AbortSignal): Promise<CuratedDealsResponse> {
  return getJson('/deals/free', signal);
}

export function getHistoricalLows(signal?: AbortSignal): Promise<HistoricalLowsResponse> {
  return getJson('/deals/historical-lows', signal);
}

export type {
  CuratedDealsResponse,
  DealResponse,
  DealsResponse,
  GameDetailResponse,
  GameSearchResponse,
  HistoricalLowsResponse,
  PriceHistoryResponse,
  StoreResponse,
};
