import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { dealSortOptions } from '@lootdrop/contracts';
import { AuthProvider, useAuth } from './auth/AuthProvider.js';
import { AccountMenu } from './components/AccountMenu.js';
import { CurrencyProvider, useCurrency } from './components/CurrencyProvider.js';
import { CuratedDealSection } from './components/CuratedDealSection.js';
import { DealCard } from './components/DealCard.js';
import { GameAutocomplete } from './components/GameAutocomplete.js';
import { LandingPage } from './components/LandingPage.js';
import { RawgAttribution } from './components/GameMedia.js';
import { TaxonomyFilter } from './components/TaxonomyFilter.js';
import {
  getBestDeals,
  getDeals,
  getFreeDeals,
  getHistoricalLows,
  getStores,
  getTaxonomy,
  type DealQueryParams,
} from './lib/api-client.js';

const AuthPage = lazy(() =>
  import('./auth/AuthPage.js').then(({ AuthPage }) => ({ default: AuthPage })),
);
const GameDetailPage = lazy(() =>
  import('./components/GameDetailPage.js').then(({ GameDetailPage }) => ({
    default: GameDetailPage,
  })),
);
const WishlistPage = lazy(() =>
  import('./components/WishlistPage.js').then(({ WishlistPage }) => ({ default: WishlistPage })),
);
const AlertsPage = lazy(() =>
  import('./components/AlertsPage.js').then(({ AlertsPage }) => ({ default: AlertsPage })),
);
const NotificationsPage = lazy(() =>
  import('./components/NotificationsPage.js').then(({ NotificationsPage }) => ({
    default: NotificationsPage,
  })),
);

function readNumber(searchParams: URLSearchParams, name: string): number | undefined {
  const raw = searchParams.get(name);
  if (raw === null || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function readSlugs(params: URLSearchParams, key: 'genre' | 'platform') {
  return [
    ...new Set(
      params
        .getAll(key)
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function Dashboard({ displayName }: { displayName: string }) {
  const { currency } = useCurrency();
  const priceUnit = currency === 'USD' ? '' : ' (USD)';
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}`;
  const searchQuery = searchParams.get('q') ?? '';
  const [searchInput, setSearchInput] = useState(searchQuery);
  const selectedStore = searchParams.get('store') ?? '';
  const selectedGenres = readSlugs(searchParams, 'genre');
  const selectedPlatforms = readSlugs(searchParams, 'platform');
  const saleFilter = searchParams.get('onSale');
  const onSale = saleFilter === 'true' ? true : saleFilter === 'false' ? false : 'all';
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
    ...(searchQuery ? { q: searchQuery } : {}),
    ...(selectedStore ? { store: selectedStore } : {}),
    ...(selectedGenres.length ? { genre: selectedGenres } : {}),
    ...(selectedPlatforms.length ? { platform: selectedPlatforms } : {}),
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
  const genresQuery = useQuery({
    queryKey: ['genres'],
    queryFn: ({ signal }) => getTaxonomy('genres', signal),
    staleTime: 60_000,
  });
  const platformsQuery = useQuery({
    queryKey: ['platforms'],
    queryFn: ({ signal }) => getTaxonomy('platforms', signal),
    staleTime: 60_000,
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
    setSearchInput(searchQuery);
  }, [searchQuery]);

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

  const toggleTaxonomy = (key: 'genre' | 'platform', slug: string, max: number) => {
    setSearchParams((current) => {
      const selected = readSlugs(current, key);
      const values = selected.includes(slug)
        ? selected.filter((value) => value !== slug)
        : [...selected, slug].slice(0, max);
      const next = new URLSearchParams(current);
      next.delete(key);
      for (const value of values) next.append(key, value);
      next.delete('page');
      return next;
    });
  };

  const clearTaxonomy = () => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('genre');
      next.delete('platform');
      next.delete('page');
      return next;
    });
  };

  const resetFilters = () => {
    setSearchInput('');
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  const deals = dealsQuery.data?.data ?? [];
  const pagination = dealsQuery.data?.pagination;
  const genres = genresQuery.data?.data ?? [];
  const platforms = platformsQuery.data?.data ?? [];
  const taxonomySelected = selectedGenres.length + selectedPlatforms.length > 0;
  const hasTaxonomy = genres.length + platforms.length > 0 || taxonomySelected;

  return (
    <main className="page-shell">
      <div className="page-inner">
        <header className="topbar">
          <div>
            <p className="eyebrow">LootDrop</p>
            <h1>Welcome back, {displayName}</h1>
          </div>
          <div className="topbar-actions">
            <GameAutocomplete />
            <AccountMenu />
          </div>
        </header>

        <section className="hero-panel">
          <div>
            <p className="panel-label">PC game prices</p>
            <h2>Find a game and compare stores.</h2>
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
              value={String(onSale)}
              onChange={(event) =>
                updateFilter('onSale', event.target.value === 'all' ? '' : event.target.value)
              }
            >
              <option value="all">All prices</option>
              <option value="true">On sale</option>
              <option value="false">Regular price</option>
            </select>
          </label>
          <label>
            Min price{priceUnit}
            <input
              aria-label={'Minimum price' + priceUnit}
              type="number"
              min="0"
              step="0.01"
              value={minPriceText}
              onChange={(event) => updateFilter('minPrice', event.target.value)}
            />
          </label>
          <label>
            Max price{priceUnit}
            <input
              aria-label={'Maximum price' + priceUnit}
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
              <option value="rating_desc">Highest rating</option>
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

        <div className={hasTaxonomy ? 'deals-with-sidebar' : undefined}>
          {hasTaxonomy ? (
            <aside className="taxonomy-sidebar" aria-label="Category and platform filters">
              <TaxonomyFilter
                label="Genres"
                options={genres}
                selected={selectedGenres}
                max={10}
                onToggle={(slug) => toggleTaxonomy('genre', slug, 10)}
              />
              <TaxonomyFilter
                label="Platforms"
                options={platforms}
                selected={selectedPlatforms}
                max={6}
                onToggle={(slug) => toggleTaxonomy('platform', slug, 6)}
              />
              {taxonomySelected ? (
                <button className="ghost-button" type="button" onClick={clearTaxonomy}>
                  Clear categories and platforms
                </button>
              ) : null}
            </aside>
          ) : null}
          <section
            className="deals-panel"
            aria-labelledby="catalog-title"
            aria-busy={dealsQuery.isFetching}
          >
            <div className="panel-header">
              <h2 id="catalog-title">Game catalog</h2>
              <span>
                {pagination ? `${pagination.totalItems} matching listings` : 'Loading deals'}
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
      </div>
    </main>
  );
}

function RequireAccount({ children }: { children: ReactNode }) {
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
  return children;
}

function AppRoutes() {
  const { state } = useAuth();
  const { pathname } = useLocation();
  useEffect(() => {
    const titles = new Map([
      ['/', state.status === 'authenticated' ? 'Game deals' : 'PC game price tracking'],
      ['/wishlist', 'My wishlist'],
      ['/alerts', 'Price alerts'],
      ['/notifications', 'Notifications'],
      ['/login', 'Log in'],
      ['/register', 'Register'],
    ]);
    if (!/^\/games\/[^/]+\/?$/i.test(pathname)) {
      document.title = `${titles.get(pathname.replace(/\/$/, '').toLowerCase() || '/') ?? 'Page not found'} | LootDrop`;
    }
  }, [pathname, state.status]);
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
      <Route
        path="/"
        element={
          state.status === 'authenticated' ? (
            <Dashboard displayName={state.user.displayName} />
          ) : (
            <LandingPage />
          )
        }
      />
      <Route
        path="/games/:slug"
        element={
          <RequireAccount>
            <GameDetailPage />
          </RequireAccount>
        }
      />
      <Route
        path="/wishlist"
        element={
          <RequireAccount>
            <WishlistPage />
          </RequireAccount>
        }
      />
      <Route
        path="/alerts"
        element={
          <RequireAccount>
            <AlertsPage />
          </RequireAccount>
        }
      />
      <Route
        path="/notifications"
        element={
          <RequireAccount>
            <NotificationsPage />
          </RequireAccount>
        }
      />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route
        path="*"
        element={
          <main className="page-shell">
            <div className="page-inner request-state">
              <h1>Page not found</h1>
              <p>This page may have moved. Return to the home page to continue.</p>
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
      <CurrencyProvider>
        <Suspense
          fallback={
            <main className="page-shell">
              <p className="request-state" role="status">
                Loading page…
              </p>
            </main>
          }
        >
          <AppRoutes />
        </Suspense>
        <footer className="site-footer">
          <Link to="/" aria-label="LootDrop home">
            LootDrop
          </Link>
          <p className="currency-footnote">
            Prices in INR and EUR are approximate conversions of USD store prices. Stores may charge
            different regional prices. Reference rates from the{' '}
            <a href="https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html">
              European Central Bank
            </a>{' '}
            via <a href="https://frankfurter.dev/">Frankfurter</a>.
          </p>
          <RawgAttribution />
        </footer>
      </CurrencyProvider>
    </AuthProvider>
  );
}
