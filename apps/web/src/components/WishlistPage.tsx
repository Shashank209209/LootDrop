import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { AccountMenu } from './AccountMenu.js';
import { WishlistButton } from './WishlistButton.js';
import { getWishlist } from '../lib/api-client.js';

function formatCurrency(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function WishlistPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawPage = Number(searchParams.get('page') ?? '1');
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const pageSize = 20;
  const query = useQuery({
    queryKey: ['wishlist', 'page', page, pageSize],
    queryFn: ({ signal }) => getWishlist(page, pageSize, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const updatePage = (nextPage: number) => {
    setSearchParams(nextPage <= 1 ? new URLSearchParams() : { page: String(nextPage) });
  };

  return (
    <main className="page-shell">
      <div className="page-inner">
        <header className="topbar">
          <div>
            <p className="eyebrow">DealHunter</p>
            <h1>My wishlist</h1>
          </div>
          <AccountMenu />
        </header>

        {query.isPending ? (
          <p role="status" className="request-state">
            Loading your wishlist…
          </p>
        ) : query.isError ? (
          <div className="request-state error-state" role="alert">
            <p>Your wishlist could not be loaded.</p>
            <button type="button" className="primary-button" onClick={() => void query.refetch()}>
              Retry
            </button>
          </div>
        ) : query.data.data.length === 0 ? (
          <div className="request-state empty-state">
            <p>Your wishlist is empty.</p>
            <Link to="/" className="primary-button">
              Browse deals
            </Link>
          </div>
        ) : (
          <>
            <section className="wishlist-list" aria-label="Wishlisted games">
              {query.data.data.map((entry) => (
                <article className="wishlist-entry" key={entry.gameId}>
                  <div className="wishlist-entry-main">
                    <h2>
                      <Link to={`/games/${encodeURIComponent(entry.gameSlug)}`}>
                        {entry.gameTitle}
                      </Link>
                    </h2>
                    {entry.bestListing ? (
                      <div className="wishlist-price">
                        <strong>
                          {formatCurrency(
                            entry.bestListing.currentPrice,
                            entry.bestListing.currency,
                          )}
                        </strong>
                        {entry.bestListing.regularPrice !== null ? (
                          <span>
                            Regular{' '}
                            {formatCurrency(
                              entry.bestListing.regularPrice,
                              entry.bestListing.currency,
                            )}
                          </span>
                        ) : null}
                        {entry.bestListing.discountPercent !== null ? (
                          <span>{entry.bestListing.discountPercent}% off</span>
                        ) : null}
                        <span>{entry.bestListing.store.name}</span>
                        <a
                          href={entry.bestListing.dealUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          View deal
                        </a>
                      </div>
                    ) : (
                      <p>No active store listings.</p>
                    )}
                  </div>
                  <WishlistButton gameId={entry.gameId} gameTitle={entry.gameTitle} />
                </article>
              ))}
            </section>
            <nav className="pagination-controls" aria-label="Wishlist pages">
              <button
                type="button"
                className="ghost-button"
                onClick={() => updatePage(page - 1)}
                disabled={page <= 1}
              >
                Previous
              </button>
              <span>
                Page {query.data.pagination.page} of {query.data.pagination.totalPages}
              </span>
              <button
                type="button"
                className="ghost-button"
                onClick={() => updatePage(page + 1)}
                disabled={!query.data.pagination.hasNextPage}
              >
                Next
              </button>
            </nav>
          </>
        )}
      </div>
    </main>
  );
}
