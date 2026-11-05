import { useMemo, useState, type FormEvent } from 'react';
import { Route, Routes } from 'react-router-dom';
import { demoDeals, summarizeDeals, type Deal } from './lib/deals.js';

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

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
  const [searchTerm, setSearchTerm] = useState('');
  const [storeFilter, setStoreFilter] = useState('All');
  const [userName, setUserName] = useState('Player');

  const stores = ['All', ...new Set(demoDeals.map((deal) => deal.store))];

  const filteredDeals = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return demoDeals.filter((deal) => {
      const matchesStore = storeFilter === 'All' || deal.store === storeFilter;
      const matchesSearch =
        term.length === 0 ||
        deal.title.toLowerCase().includes(term) ||
        deal.genre.toLowerCase().includes(term) ||
        deal.store.toLowerCase().includes(term);

      return matchesStore && matchesSearch;
    });
  }, [searchTerm, storeFilter]);

  const summary = useMemo(() => summarizeDeals(filteredDeals), [filteredDeals]);
  const topDeals = useMemo(
    () => [...filteredDeals].sort((a, b) => b.discountPercent - a.discountPercent).slice(0, 3),
    [filteredDeals],
  );
  const newGames = useMemo(
    () => [...filteredDeals].sort((a, b) => b.rating - a.rating).slice(0, 3),
    [filteredDeals],
  );

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

  return (
    <main className="page-shell">
      <div className="page-inner">
        <header className="topbar">
          <div>
            <p className="eyebrow">DealHunter</p>
            <h1>Welcome back, {userName}</h1>
          </div>

          <div className="topbar-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setIsAuthenticated(false)}
            >
              Log out
            </button>
          </div>
        </header>

        <section className="hero-panel">
          <div>
            <p className="panel-label">Game insights</p>
            <h2>Discover new releases and price drops.</h2>
          </div>

          <div className="search-wrap">
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search games, genres, stores..."
              aria-label="Search deals"
            />
          </div>
        </section>

        <section className="filters-row" aria-label="Store filters">
          {stores.map((store) => (
            <button
              key={store}
              type="button"
              className={storeFilter === store ? 'filter-chip active' : 'filter-chip'}
              onClick={() => setStoreFilter(store)}
            >
              {store}
            </button>
          ))}
        </section>

        <section className="summary-grid" aria-label="Deal summary">
          <article className="summary-card">
            <span>Total finds</span>
            <strong>{summary.totalDeals}</strong>
          </article>
          <article className="summary-card">
            <span>On sale</span>
            <strong>{summary.onSaleCount}</strong>
          </article>
          <article className="summary-card">
            <span>Avg. discount</span>
            <strong>{summary.averageDiscount}%</strong>
          </article>
          <article className="summary-card accent">
            <span>Cheapest</span>
            <strong>{currency.format(summary.cheapestPrice)}</strong>
          </article>
        </section>

        <section className="highlight-panel" aria-label="Best deal">
          <div>
            <p className="panel-label">Best deal right now</p>
            <h2>{summary.bestDeal?.title ?? 'No sales available'}</h2>
          </div>
          <div className="highlight-meta">
            <span>{summary.bestDeal?.store ?? '—'}</span>
            <strong>{summary.bestDeal ? `${summary.bestDeal.discountPercent}% off` : '—'}</strong>
          </div>
        </section>

        <section className="content-grid">
          <div className="panel-stack">
            <div className="panel-header">
              <h3>New games</h3>
              <span>{newGames.length} picks</span>
            </div>

            <div className="mini-list">
              {newGames.map((deal) => (
                <article key={deal.id} className="mini-card">
                  <div className="mini-badge">{deal.releaseLabel}</div>
                  <h4>{deal.title}</h4>
                  <div className="mini-meta">
                    <span>{deal.genre}</span>
                    <span>{deal.rating.toFixed(1)} ★</span>
                  </div>
                  <strong>{currency.format(deal.price)}</strong>
                </article>
              ))}
            </div>
          </div>

          <div className="panel-stack">
            <div className="panel-header">
              <h3>Best discounts</h3>
              <span>{topDeals.length} deals</span>
            </div>

            <div className="mini-list">
              {topDeals.map((deal) => (
                <article key={`top-${deal.id}`} className="mini-card">
                  <div className="mini-badge sale">-{deal.discountPercent}%</div>
                  <h4>{deal.title}</h4>
                  <div className="mini-meta">
                    <span>{deal.store}</span>
                    <span>{currency.format(deal.regularPrice)}</span>
                  </div>
                  <strong>{currency.format(deal.price)}</strong>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="deals-panel">
          <div className="panel-header">
            <h3>Trending deals</h3>
            <span>{filteredDeals.length} results</span>
          </div>

          <div className="deal-grid">
            {filteredDeals.map((deal: Deal) => (
              <article key={deal.id} className="deal-card">
                <div className="deal-cover" aria-hidden="true">
                  {deal.image ? (
                    <img src={deal.image} alt="" />
                  ) : (
                    <span>{deal.title.slice(0, 1)}</span>
                  )}
                </div>

                <div className="deal-body">
                  <div className="deal-header">
                    <div>
                      <p className="deal-store">{deal.store}</p>
                      <h4>{deal.title}</h4>
                    </div>
                    <span className={`badge ${deal.isOnSale ? 'sale' : ''}`}>
                      {deal.isOnSale ? `${deal.discountPercent}%` : 'Regular'}
                    </span>
                  </div>

                  <div className="deal-meta-line">
                    <span>{deal.genre}</span>
                    <span>{deal.releaseLabel}</span>
                  </div>

                  <div className="price-row">
                    <strong>{currency.format(deal.price)}</strong>
                    {deal.regularPrice > 0 && deal.regularPrice !== deal.price ? (
                      <span>{currency.format(deal.regularPrice)}</span>
                    ) : null}
                  </div>

                  <a href={deal.url} target="_blank" rel="noreferrer">
                    View deal
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

export default function AppRouter() {
  return (
    <Routes>
      <Route path="*" element={<App />} />
    </Routes>
  );
}
