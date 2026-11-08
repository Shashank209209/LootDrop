import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getWishlistIds, setAccessToken } from './api-client.js';

const sessionResponse = {
  user: {
    id: '20da2e1d-c56e-4874-8e7c-f5d15d38d502',
    email: 'player@example.test',
    displayName: 'Player',
  },
  accessToken: 'replacement-test-token',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  setAccessToken(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('authenticated API client', () => {
  it('refreshes once and retries a request after an expired access token', async () => {
    setAccessToken('expired-test-token');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401))
      .mockResolvedValueOnce(jsonResponse(sessionResponse))
      .mockResolvedValueOnce(jsonResponse({ gameIds: ['game-id'] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getWishlistIds()).resolves.toEqual({ gameIds: ['game-id'] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has('Authorization')).toBe(true);
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/auth/refresh');
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ credentials: 'include', method: 'POST' });
    expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).has('Authorization')).toBe(true);
  });

  it('shares one refresh request between concurrent 401 responses', async () => {
    setAccessToken('expired-test-token');
    let releaseRefresh!: (response: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => {
      releaseRefresh = resolve;
    });
    let protectedRequests = 0;
    let refreshRequests = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/auth/refresh')) {
        refreshRequests += 1;
        return refreshResponse;
      }
      protectedRequests += 1;
      return Promise.resolve(
        protectedRequests <= 2
          ? jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401)
          : jsonResponse({ gameIds: [] }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = getWishlistIds();
    const second = getWishlistIds();
    await vi.waitFor(() => expect(refreshRequests).toBe(1));
    releaseRefresh(jsonResponse(sessionResponse));

    await expect(Promise.all([first, second])).resolves.toEqual([{ gameIds: [] }, { gameIds: [] }]);
    expect(refreshRequests).toBe(1);
    expect(protectedRequests).toBe(4);
  });

  it('clears an invalid access token and returns the protected request error when refresh fails', async () => {
    setAccessToken('expired-test-token');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getWishlistIds()).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has('Authorization')).toBe(true);
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).has('Authorization')).toBe(false);
  });
});
