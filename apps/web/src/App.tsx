import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { dealSortOptions } from '@dealhunter/contracts';
import { AuthPage } from './auth/AuthPage.js';
import { AuthProvider, useAuth } from './auth/AuthProvider.js';
import { AccountMenu } from './components/AccountMenu.js';
import { CuratedDealSection } from './components/CuratedDealSection.js';
import { DealCard } from './components/DealCard.js';
import { GameAutocomplete } from './components/GameAutocomplete.js';
import { GameDetailPage } from './components/GameDetailPage.js';
import { WishlistPage } from './components/WishlistPage.js';
import {
  getBestDeals,
  getDeals,
  getFreeDeals,
  getHistoricalLows,
  getStores,
  type DealQueryParams,
} from './lib/api-client.js';

function readNumber(searchParams: URLSearchParams, name: string): number | undefined {
  const raw = searchParams.get(name);
  if (raw === null || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function Dashboard() {
  const { state } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}`;
  const urlQuery = searchParams.toString();
  const [searchInput, setSearchInput] = useState(searchParams.get('q') ?? '');
  const selectedStore = searchParams.get('store') ?? '';
  const onSale = searchParams.get('onSale') !== 'false';
  const minPriceText = searchParams.get('minPrice') ?? '';
  const maxPriceText = searchParams.get('maxPrice') ?? '';
  const minDiscountText = searchParams.get('minDiscount') ?? '';
  const sort =
    dealSortOptions.find((option) => option === searchParams.get('sort')) ?? 'discount_desc';
  const page = readNumber(searchParams, 'page') ?? 1;
  const pageSize = readNumber(searchParams, 'pageSize') ?? 20;
  const minPrice = readNumber(searchParams, 'minPrice');
  const maxPrice = readNumber(searchParams, 'maxPrice');
  const minDiscount = readNumber(searchParams, 'minDiscount');

  const apiQuery: DealQueryParams = {
    ...(searchParams.get('q') ? { q: searchParams.get('q')! } : {}),
    ...(selectedStore ? { store: selectedStore } : {}),
    onSale,
    ...(minPrice !== undefined ? { minPrice } : {}),
    ...(maxPrice !== undefined ? { maxPrice } : {}),
    ...(minDiscount !== undefined ? { minDiscount } : {}),
    sort,
    page,
    pageSize,
  };

  const dealsQuery = useQuery({
    queryKey: ['deals', apiQuery],
    queryFn: ({ signal }) => getDeals(apiQuery, signal),
    placeholderData: keepPreviousData,
  });
  const storesQuery = useQuery({
    queryKey: ['stores'],
    queryFn: ({ signal }) => getStores(signal),
    staleTime: 5 * 60 * 1000,
  });
  const bestDealsQuery = useQuery({
    queryKey: ['best-deals'],
    queryFn: ({ signal }) => getBestDeals(signal),
    staleTime: 60_000,
  });
  const freeDealsQuery = useQuery({
    queryKey: ['free-deals'],
    queryFn: ({ signal }) => getFreeDeals(signal),
    staleTime: 60_000,
  });
  const historicalLowsQuery = useQuery({
    queryKey: ['historical-lows'],
    queryFn: ({ signal }) => getHistoricalLows(signal),
    staleTime: 60_000,
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const currentQuery = searchParams.get('q') ?? '';
      const nextQuery = searchInput.trim();
      if (currentQuery === nextQuery) return;
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (nextQuery) next.set('q', nextQuery);
          else next.delete('q');
          next.delete('page');
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput, searchParams, setSearchParams]);

  useEffect(() => {
    setSearchInput(searchParams.get('q') ?? '');
  }, [urlQuery, searchParams]);

  const updateFilter = (key: string, value: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete('page');
      return next;
    });
  };

  const updatePage = (nextPage: number) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextPage <= 1) next.delete('page');
      else next.set('page', String(nextPage));
      return next;
    });
  };

  const resetFilters = () => {
    setSearchInput('');
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  const deals = dealsQuery.data?.data ?? [];
  const pagination = dealsQuery.data?.pagination;

  return (
    <main className="page-shell">
      <div className="page-inner">
        <header className="topbar">
          <div>
            <p className="eyebrow">DealHunter</p>
            <h1>
              {state.status === 'authenticated'
                ? `Welcome back, ${state.user.displayName}`
                : 'Discover game deals'}
            </h1>
          </div>
          <div className="topbar-actions">
            <GameAutocomplete />
            <AccountMenu />
          </div>
        </header>

        <section className="hero-panel">
          <div>
            <p className="panel-label">Live game deals</p>
            <h2>Discover current prices from tracked stores.</h2>
          </div>
          <div className="search-wrap">
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search game titles..."
              aria-label="Search deals"
              maxLength={100}
            />
          </div>
        </section>

        <section className="deal-filters" aria-label="Deal filters">
          <label>
            Store
            <select
              aria-label="Store"
              value={selectedStore}
              onChange={(event) => updateFilter('store', event.target.value)}
            >
              <option value="">All stores</option>
              {(storesQuery.data?.data ?? []).map((store) => (
                <option key={store.id} value={store.slug}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sale status
            <select
              aria-label="Sale status"
              value={onSale ? 'true' : 'false'}
              onChange={(event) =>
                updateFilter('onSale', event.target.value === 'true' ? '' : 'false')
              }
            >
              <option value="true">On sale</option>
              <option value="false">All prices</option>
            </select>
          </label>
          <label>
            Min price
            <input
              aria-label="Minimum price"
              type="number"
              min="0"
              step="0.01"
              value={minPriceText}
              onChange={(event) => updateFilter('minPrice', event.target.value)}
            />
          </label>
          <label>
            Max price
            <input
              aria-label="Maximum price"
              type="number"
              min="0"
              step="0.01"
              value={maxPriceText}
              onChange={(event) => updateFilter('maxPrice', event.target.value)}
            />
          </label>
          <label>
            Minimum discount
            <input
              aria-label="Minimum discount"
              type="number"
              min="0"
              max="100"
              value={minDiscountText}
              onChange={(event) => updateFilter('minDiscount', event.target.value)}
            />
          </label>
          <label>
            Sort
            <select
              aria-label="Sort deals"
              value={sort}
              onChange={(event) => updateFilter('sort', event.target.value)}
            >
              <option value="discount_desc">Biggest discount</option>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
              <option value="newest">Recently checked</option>
              <option value="title_asc">Title: A to Z</option>
            </select>
          </label>
          <label>
            Per page
            <select
              aria-label="Page size"
              value={String(pageSize)}
              onChange={(event) => updateFilter('pageSize', event.target.value)}
            >
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
            </select>
          </label>
        </section>

        <div className="curated-sections">
          <CuratedDealSection
            title="Best deals"
            data={bestDealsQuery.data?.data}
            isPending={bestDealsQuery.isPending}
            isError={bestDealsQuery.isError}
            error={bestDealsQuery.error}
            returnTo={returnTo}
            onRetry={() => void bestDealsQuery.refetch()}
          />
          <CuratedDealSection
            title="Free games"
            data={freeDealsQuery.data?.data}
            isPending={freeDealsQuery.isPending}
            isError={freeDealsQuery.isError}
            error={freeDealsQuery.error}
            returnTo={returnTo}
            onRetry={() => void freeDealsQuery.refetch()}
          />
          <CuratedDealSection
            title="Historical lows"
            data={historicalLowsQuery.data?.data}
            isPending={historicalLowsQuery.isPending}
            isError={historicalLowsQuery.isError}
            error={historicalLowsQuery.error}
            returnTo={returnTo}
            onRetry={() => void historicalLowsQuery.refetch()}
          />
        </div>

        <section className="deals-panel" aria-label="Live deals" aria-busy={dealsQuery.isFetching}>
          <div className="panel-header">
            <h3>Current deals</h3>
            <span>
              {pagination ? `${pagination.totalItems} matching deals` : 'Loading deals'}
              {dealsQuery.isFetching && dealsQuery.data ? ' · Updating' : ''}
            </span>
          </div>

          {storesQuery.isError ? (
            <p className="inline-error">Store filters could not be loaded.</p>
          ) : null}

          {dealsQuery.isError ? (
            <div className="request-state error-state" role="alert">
              <p>Deals could not be loaded: {dealsQuery.error.message}</p>
              <button
                type="button"
                className="primary-button"
                onClick={() => void dealsQuery.refetch()}
              >
                Retry
              </button>
            </div>
          ) : dealsQuery.isPending ? (
            <div className="deal-grid" aria-label="Loading deals">
              {Array.from({ length: 6 }, (_, index) => (
                <div className="deal-card deal-skeleton" key={index}>
                  <div className="deal-cover" />
                  <div className="skeleton-lines">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              ))}
            </div>
          ) : deals.length === 0 ? (
            <div className="request-state empty-state">
              <p>No deals match your filters.</p>
              <button type="button" className="ghost-button" onClick={resetFilters}>
                Reset filters
              </button>
            </div>
          ) : (
            <>
              <div className="deal-grid">
                {deals.map((deal) => (
                  <DealCard key={deal.id} deal={deal} returnTo={returnTo} />
                ))}
              </div>
              <nav className="pagination-controls" aria-label="Deal pages">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => updatePage(page - 1)}
                  disabled={page <= 1}
                >
                  Previous
                </button>
                <span>
                  Page {pagination?.page ?? page} of {pagination?.totalPages ?? 0}
                </span>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => updatePage(page + 1)}
                  disabled={!pagination?.hasNextPage}
                >
                  Next
                </button>
              </nav>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function ProtectedWishlist() {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status !== 'authenticated') {
    return (
      <Navigate
        to="/login"
        replace
        state={{ returnTo: `${location.pathname}${location.search}${location.hash}` }}
      />
    );
  }
  return <WishlistPage />;
}

function AppRoutes() {
  const { state } = useAuth();
  if (state.status === 'loading') {
    return (
      <main className="page-shell">
        <div className="page-inner request-state" role="status">
          Restoring your session…
        </div>
      </main>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/games/:slug" element={<GameDetailPage />} />
      <Route path="/wishlist" element={<ProtectedWishlist />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route
        path="*"
        element={
          <main className="page-shell">
            <div className="page-inner request-state">
              <h1>Page not found</h1>
              <Link className="ghost-button" to="/">
                Back to deals
              </Link>
            </div>
          </main>
        }
      />
    </Routes>
  );
}

export default function AppRouter() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
