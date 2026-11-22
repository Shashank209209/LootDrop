import { Link } from 'react-router-dom';

export function LandingPage() {
  return (
    <main className="landing-shell">
      <div className="landing-panel">
        <div className="landing-copy">
          <p className="eyebrow">LootDrop</p>
          <h1>Find your next game for less.</h1>
          <p>
            Compare PC game prices across stores and see how prices have changed before you buy.
          </p>
          <nav className="landing-actions" aria-label="Get started">
            <Link className="primary-button" to="/register">
              Create an account
            </Link>
            <Link className="ghost-button" to="/login">
              Log in
            </Link>
          </nav>
        </div>
        <dl className="landing-features">
          <div>
            <dt>Browse the full catalog</dt>
            <dd>Explore games at regular prices and on sale.</dd>
          </div>
          <div>
            <dt>Compare store prices</dt>
            <dd>Check listings and price history in one place.</dd>
          </div>
          <div>
            <dt>Track games you want</dt>
            <dd>Save a wishlist and set alerts for your target price.</dd>
          </div>
        </dl>
      </div>
    </main>
  );
}
