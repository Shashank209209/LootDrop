import { useState } from 'react';
import { Link } from 'react-router-dom';
import controllerArt from '../assets/landing-controller.webp';
import './LandingPage.css';

const themeKey = 'lootdrop.landing-theme';

const features = [
  {
    icon: '▦',
    title: 'Explore the catalog',
    description: 'Find PC games by genre and platform, including games at regular price.',
  },
  {
    icon: '↘',
    title: 'Compare prices',
    description: 'Check prices across stores and see how they’ve changed over time.',
  },
  {
    icon: '◇',
    title: 'Set a price alert',
    description: 'Save games to your wishlist and get notified when they hit your target price.',
  },
];

function readTheme(): 'light' | 'dark' {
  try {
    const saved = window.localStorage.getItem(themeKey);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // The system preference is still available when storage is blocked.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function LandingPage() {
  const [theme, setTheme] = useState(readTheme);

  function toggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    try {
      window.localStorage.setItem(themeKey, next);
    } catch {
      // The selected theme still applies for this visit.
    }
  }

  return (
    <div className="landing-shell" data-theme={theme}>
      <header className="landing-header">
        <span className="landing-brand">
          <span className="landing-mark" aria-hidden="true">
            L
          </span>
          LootDrop
        </span>
        <button
          className="landing-theme"
          type="button"
          aria-pressed={theme === 'dark'}
          onClick={toggleTheme}
        >
          <span aria-hidden="true">◐</span>
          Dark mode
        </button>
      </header>

      <main className="landing-content">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-copy">
            <p className="landing-kicker">PC game price tracker</p>
            <h1 id="landing-title">
              Find your next game <span>for less.</span>
            </h1>
            <p className="landing-description">
              Compare PC game prices across stores, check price history, and get an alert when the
              game you want hits your price.
            </p>
            <nav className="landing-actions" aria-label="Get started">
              <Link className="landing-cta" to="/register">
                Create an account <span aria-hidden="true">↗</span>
              </Link>
              <Link className="landing-login" to="/login">
                Log in
              </Link>
            </nav>
          </div>

          <figure className="landing-visual">
            <img src={controllerArt} width="1200" height="900" alt="" />
            <figcaption className="landing-preview">
              <span className="landing-preview-icon" aria-hidden="true">
                ↘
              </span>
              <span>
                <span className="landing-preview-label">Example price alert</span>
                <strong>Your target price was reached</strong>
              </span>
            </figcaption>
          </figure>
        </section>

        <section className="landing-benefits" aria-label="What you can do with LootDrop">
          {features.map(({ icon, title, description }) => (
            <article className="landing-feature" key={title}>
              <span className="landing-feature-icon" aria-hidden="true">
                {icon}
              </span>
              <div>
                <h2>{title}</h2>
                <p>{description}</p>
              </div>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
