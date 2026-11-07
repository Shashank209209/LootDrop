import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Route, Routes, useSearchParams } from 'react-router-dom';
import { dealSortOptions, type DealResponse } from '@dealhunter/contracts';
import { getDeals, getStores, type DealQueryParams } from './lib/api-client.js';

type AuthMode = 'login' | 'register';

type AuthForm = {
  name: string;
  email: string;
  password: string;
};

const emptyForm: AuthForm = {
  name: '',
  email: '',
  password: '',
};

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [authForm, setAuthForm] = useState<AuthForm>(emptyForm);
  const [authError, setAuthError] = useState('');
  const [userName, setUserName] = useState('Player');

  const handleAuthChange = (field: keyof AuthForm, value: string) => {
    setAuthForm((current) => ({ ...current, [field]: value }));
    setAuthError('');
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const email = authForm.email.trim();
    const password = authForm.password.trim();

    if (!email || !password || (authMode === 'register' && !authForm.name.trim())) {
      setAuthError('Please complete all required fields.');
      return;
    }

    if (!email.includes('@') || !email.includes('.')) {
      setAuthError('Use a valid email address.');
      return;
    }

    if (password.length < 6) {
      setAuthError('Password must contain at least 6 characters.');
      return;
    }

    const displayName = authMode === 'register' ? authForm.name.trim() : email.split('@')[0];
    setUserName(displayName || 'Player');
    setIsAuthenticated(true);
  };

  if (!isAuthenticated) {
    return (
      <main className="auth-shell">
        <div className="auth-panel">
          <div className="auth-copy">
            <p className="eyebrow">DealHunter</p>
            <h1>Track the best game deals before everyone else.</h1>
            <p className="auth-subtitle">
              Sign in to discover new titles, price drops, and the top gaming bargains curated for
              you.
            </p>

            <ul className="feature-list">
              <li>Live deal tracking</li>
              <li>Smart game search</li>
              <li>Best discount alerts</li>
            </ul>
          </div>

          <div className="auth-card">
            <div className="auth-toggle">
              <button
                type="button"
                className={authMode === 'login' ? 'active' : ''}
                onClick={() => setAuthMode('login')}
              >
                Log in
              </button>
              <button
                type="button"
                className={authMode === 'register' ? 'active' : ''}
                onClick={() => setAuthMode('register')}
              >
                Register
              </button>
            </div>

            <form onSubmit={handleSubmit} className="auth-form">
              {authMode === 'register' ? (
                <label>
                  Full name
                  <input
                    value={authForm.name}
                    onChange={(event) => handleAuthChange('name', event.target.value)}
                    placeholder="Alex Morgan"
                  />
                </label>
              ) : null}

              <label>
                Email address
                <input
                  type="email"
                  value={authForm.email}
                  onChange={(event) => handleAuthChange('email', event.target.value)}
                  placeholder="you@example.com"
                />
              </label>

              <label>
                Password
                <input
                  type="password"
                  value={authForm.password}
                  onChange={(event) => handleAuthChange('password', event.target.value)}
                  placeholder="Minimum 6 characters"
                />
              </label>

              {authError ? <p className="auth-error">{authError}</p> : null}

              <button type="submit" className="primary-button">
                {authMode === 'login' ? 'Log in' : 'Create account'}
              </button>
            </form>
          </div>
        </div>
      </main>
    );
  }

  return <Dashboard userName={userName} onLogout={() => setIsAuthenticated(false)} />;
}

type DashboardProps = { userName: string; onLogout: () => void };

function readNumber(searchParams: URLSearchParams, name: string): number | undefined {
  const raw = searchParams.get(name);
  if (raw === null || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function Dashboard({ userName, onLogout }: DashboardProps) {
  const [searchParams, setSearchParams] = useSearchParams();
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
            <h1>Welcome back, {userName}</h1>
          </div>
          <button type="button" className="ghost-button" onClick={onLogout}>
            Log out
          </button>
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
                  <DealCard key={deal.id} deal={deal} />
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

function DealCard({ deal }: { deal: DealResponse }) {
  return (
    <article className="deal-card">
      <div className="deal-cover" aria-hidden="true">
        <span>{deal.gameTitle.slice(0, 1) || '?'}</span>
      </div>
      <div className="deal-body">
        <div className="deal-header">
          <div>
            <p className="deal-store">{deal.store.name}</p>
            <h4>{deal.gameTitle}</h4>
          </div>
          {deal.discountPercent !== null ? (
            <span className={`badge ${deal.isOnSale ? 'sale' : ''}`}>
              {deal.isOnSale ? `${deal.discountPercent}% off` : 'Regular'}
            </span>
          ) : null}
        </div>
        <div className="deal-meta-line">
          <span>{deal.isOnSale ? 'On sale' : 'Regular price'}</span>
          <span>Checked {new Date(deal.lastCheckedAt).toLocaleString()}</span>
        </div>
        <div className="price-row">
          <strong>{formatCurrency(deal.currentPrice, deal.currency)}</strong>
          {deal.regularPrice !== null && deal.regularPrice !== deal.currentPrice ? (
            <span>{formatCurrency(deal.regularPrice, deal.currency)}</span>
          ) : null}
        </div>
        <a href={deal.dealUrl} target="_blank" rel="noreferrer">
          View deal
        </a>
      </div>
    </article>
  );
}

export default function AppRouter() {
  return (
    <Routes>
      <Route path="*" element={<App />} />
    </Routes>
  );
}
