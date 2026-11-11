import type {
  AuthSessionResponse,
  AuthUser,
  CuratedDealsResponse,
  DealResponse,
  DealsQuery,
  DealsResponse,
  GameDetailResponse,
  GameSearchResponse,
  HistoricalLowsResponse,
  LoginRequest,
  MeResponse,
  PriceHistoryQuery,
  PriceHistoryResponse,
  RegisterRequest,
  StoreResponse,
  WishlistAddRequest,
  WishlistEntry,
  WishlistIdsResponse,
  WishlistResponse,
} from '@dealhunter/contracts';

export type DealQueryParams = Partial<
  Pick<
    DealsQuery,
    'q' | 'onSale' | 'minPrice' | 'maxPrice' | 'minDiscount' | 'sort' | 'page' | 'pageSize'
  >
> & { store?: string | string[] };

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
let accessToken: string | null = null;
let refreshInFlight: Promise<AuthSessionResponse | null> | null = null;
let restoreInFlight: Promise<AuthSessionResponse | null> | null = null;

function notifySessionExpired(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('lootdrop:session-expired'));
  }
}

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

async function responseJson<T>(response: Response): Promise<T> {
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
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function authRequest(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
}

async function refreshAccessToken(): Promise<AuthSessionResponse | null> {
  if (!refreshInFlight) {
    refreshInFlight = authRequest('/auth/refresh', { method: 'POST' })
      .then(async (response) => {
        if (!response.ok) {
          accessToken = null;
          notifySessionExpired();
          return null;
        }
        const session = (await response.json()) as AuthSessionResponse;
        accessToken = session.accessToken;
        return session;
      })
      .catch(() => {
        accessToken = null;
        notifySessionExpired();
        return null;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

export function restoreSession(): Promise<AuthSessionResponse | null> {
  if (!restoreInFlight) {
    restoreInFlight = refreshAccessToken();
  }
  return restoreInFlight;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

async function authenticatedJson<T>(
  path: string,
  init: RequestInit = {},
  retryAfterRefresh = true,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
  if (response.status === 401 && retryAfterRefresh && !init.signal?.aborted) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return authenticatedJson<T>(path, init, false);
  }
  return responseJson<T>(response);
}

async function publicJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  return responseJson(await authRequest(path, init));
}

function jsonBody(value: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  };
}

export async function registerAccount(input: RegisterRequest): Promise<AuthSessionResponse> {
  const session = await publicJson<AuthSessionResponse>('/auth/register', jsonBody(input));
  accessToken = session.accessToken;
  restoreInFlight = Promise.resolve(session);
  return session;
}

export async function login(input: LoginRequest): Promise<AuthSessionResponse> {
  const session = await publicJson<AuthSessionResponse>('/auth/login', jsonBody(input));
  accessToken = session.accessToken;
  restoreInFlight = Promise.resolve(session);
  return session;
}

export async function logout(): Promise<void> {
  try {
    await responseJson<void>(await authRequest('/auth/logout', { method: 'POST' }));
  } finally {
    accessToken = null;
    restoreInFlight = Promise.resolve(null);
  }
}

export async function getMe(): Promise<MeResponse> {
  return authenticatedJson('/auth/me');
}

export async function getDeals(
  query: DealQueryParams,
  signal?: AbortSignal,
): Promise<DealsResponse> {
  const search = queryString(query);
  return responseJson(
    await fetch(`${baseUrl}/deals${search ? `?${search}` : ''}`, {
      ...(signal ? { signal } : {}),
      credentials: 'include',
    }),
  );
}

export async function getStores(signal?: AbortSignal): Promise<{ data: StoreResponse[] }> {
  return responseJson(
    await fetch(`${baseUrl}/stores`, {
      ...(signal ? { signal } : {}),
      credentials: 'include',
    }),
  );
}

export function searchGames(q: string, signal?: AbortSignal): Promise<GameSearchResponse> {
  return fetch(`${baseUrl}/games/search?${new URLSearchParams({ q })}`, {
    ...(signal ? { signal } : {}),
    credentials: 'include',
  }).then(responseJson<GameSearchResponse>);
}

export function getGame(slug: string, signal?: AbortSignal): Promise<GameDetailResponse> {
  return fetch(`${baseUrl}/games/${encodeURIComponent(slug)}`, {
    ...(signal ? { signal } : {}),
    credentials: 'include',
  }).then(responseJson<GameDetailResponse>);
}

export function getPriceHistory(
  slug: string,
  query: PriceHistoryQuery,
  signal?: AbortSignal,
): Promise<PriceHistoryResponse> {
  const params = new URLSearchParams({ range: query.range });
  if (query.store) params.set('store', query.store);
  return fetch(`${baseUrl}/games/${encodeURIComponent(slug)}/price-history?${params}`, {
    ...(signal ? { signal } : {}),
    credentials: 'include',
  }).then(responseJson<PriceHistoryResponse>);
}

export async function getBestDeals(signal?: AbortSignal): Promise<CuratedDealsResponse> {
  return responseJson(
    await fetch(`${baseUrl}/deals/best`, {
      ...(signal ? { signal } : {}),
      credentials: 'include',
    }),
  );
}

export async function getFreeDeals(signal?: AbortSignal): Promise<CuratedDealsResponse> {
  return responseJson(
    await fetch(`${baseUrl}/deals/free`, {
      ...(signal ? { signal } : {}),
      credentials: 'include',
    }),
  );
}

export async function getHistoricalLows(signal?: AbortSignal): Promise<HistoricalLowsResponse> {
  return responseJson(
    await fetch(`${baseUrl}/deals/historical-lows`, {
      ...(signal ? { signal } : {}),
      credentials: 'include',
    }),
  );
}

export async function getWishlist(
  page = 1,
  pageSize = 20,
  signal?: AbortSignal,
): Promise<WishlistResponse> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  return authenticatedJson(`/wishlist?${params}`, signal ? { signal } : {});
}

export async function getWishlistIds(signal?: AbortSignal): Promise<WishlistIdsResponse> {
  return authenticatedJson('/wishlist/ids', signal ? { signal } : {});
}

export async function addWishlistGame(gameId: string): Promise<{ gameId: string; added: boolean }> {
  return authenticatedJson('/wishlist', jsonBody({ gameId } satisfies WishlistAddRequest));
}

export async function removeWishlistGame(gameId: string): Promise<void> {
  await authenticatedJson<void>(`/wishlist/${encodeURIComponent(gameId)}`, { method: 'DELETE' });
}

export type {
  AuthSessionResponse,
  AuthUser,
  CuratedDealsResponse,
  DealResponse,
  DealsResponse,
  GameDetailResponse,
  GameSearchResponse,
  HistoricalLowsResponse,
  PriceHistoryResponse,
  StoreResponse,
  WishlistEntry,
  WishlistIdsResponse,
  WishlistResponse,
};
