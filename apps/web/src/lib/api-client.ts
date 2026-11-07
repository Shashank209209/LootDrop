import type { DealResponse, DealsQuery, DealsResponse, StoreResponse } from '@dealhunter/contracts';

export type DealQueryParams = Partial<
  Pick<
    DealsQuery,
    'q' | 'onSale' | 'minPrice' | 'maxPrice' | 'minDiscount' | 'sort' | 'page' | 'pageSize'
  >
> & { store?: string | string[] };

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1';

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
      error?: { message?: string };
    } | null;
    throw new Error(body?.error?.message ?? `Request failed with status ${response.status}`);
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

export type { DealResponse, DealsResponse, StoreResponse };
