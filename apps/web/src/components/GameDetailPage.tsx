import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { getGame, getPriceHistory, ApiError } from '../lib/api-client.js';
import { AccountMenu } from './AccountMenu.js';
import { PriceHistoryChart } from './PriceHistoryChart.js';
import { WishlistButton } from './WishlistButton.js';
import { SetAlertButton } from './SetAlertButton.js';

const historyRanges = ['30d', '90d', '1y', 'all'] as const;
type HistoryRange = (typeof historyRanges)[number];
type ListingSort = 'price' | 'store';

function formatCurrency(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function isNotFound(error: unknown) {
  return error instanceof ApiError && error.status === 404;
}

export function GameDetailPage() {
  const { slug = '' } = useParams();
  const location = useLocation();
  const [range, setRange] = useState<HistoryRange>('90d');
  const [listingSort, setListingSort] = useState<ListingSort>('price');
  const state = location.state as { returnTo?: unknown } | null;
  const backTarget =
    typeof state?.returnTo === 'string' && state.returnTo.startsWith('/') ? state.returnTo : '/';

  const gameQuery = useQuery({
    queryKey: ['game', slug],
    queryFn: ({ signal }) => getGame(slug, signal),
    enabled: Boolean(slug),
    retry: false,
  });
  const historyQuery = useQuery({
    queryKey: ['price-history', slug, range],
    queryFn: ({ signal }) => getPriceHistory(slug, { range }, signal),
    enabled: Boolean(slug) && gameQuery.isSuccess,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const game = gameQuery.data?.data;
  const listings = useMemo(() => {
    const items = [...(game?.listings ?? [])];
    return items.sort((left, right) => {
      const byCurrency = left.currency.localeCompare(right.currency);
      if (byCurrency !== 0) return byCurrency;
      if (listingSort === 'store') {
        return left.store.name.localeCompare(right.store.name) || left.id.localeCompare(right.id);
      }
      return (
        left.currentPrice - right.currentPrice ||
        left.store.name.localeCompare(right.store.name) ||
        left.id.localeCompare(right.id)
      );
    });
  }, [game?.listings, listingSort]);
  const cheapestListingIds = useMemo(() => {
    const lowestByCurrency = new Map<string, number>();
    for (const listing of listings) {
      const lowest = lowestByCurrency.get(listing.currency);
      if (lowest === undefined || listing.currentPrice < lowest) {
        lowestByCurrency.set(listing.currency, listing.currentPrice);
      }
    }
    return new Set(
      listings
        .filter((listing) => listing.currentPrice === lowestByCurrency.get(listing.currency))
        .map((listing) => listing.id),
    );
  }, [listings]);

  if (gameQuery.isPending) {
    return (
      <main className="page-shell">
        <div className="page-inner request-state" role="status">
          Loading game details…
        </div>
      </main>
    );
  }
  if (isNotFound(gameQuery.error)) {
    return (
      <main className="page-shell">
        <div className="page-inner request-state">
          <h1>Game not found</h1>
          <p>This game is not in the tracked catalog.</p>
          <Link className="ghost-button" to={backTarget}>
            Back to deals
          </Link>
        </div>
      </main>
    );
  }
  if (gameQuery.isError || !game) {
    const message = gameQuery.error instanceof Error ? gameQuery.error.message : 'Unknown error';
    return (
      <main className="page-shell">
        <div className="page-inner request-state error-state" role="alert">
          <p>Game details could not be loaded: {message}</p>
          <button type="button" className="primary-button" onClick={() => void gameQuery.refetch()}>
            Retry
          </button>
          <Link className="ghost-button" to={backTarget}>
            Back to deals
          </Link>
        </div>
      </main>
    );
  }

  const summaryCurrency =
    new Set(listings.map((listing) => listing.currency)).size === 1 ? listings[0]?.currency : null;
  return (
    <main className="page-shell">
      <div className="page-inner game-detail">
        <header className="topbar">
          <Link className="back-link" to={backTarget}>
            ← Back to deals
          </Link>
          <AccountMenu />
        </header>
        <header className="game-detail-header">
          <div className="deal-cover game-detail-cover" aria-hidden="true">
            <span>{game.game.title.slice(0, 1) || '?'}</span>
          </div>
          <div>
            <p className="eyebrow">Game details</p>
            <h1>{game.game.title}</h1>
            <p>
              {game.summary.snapshotCount} recorded price observations
              {game.summary.lowestRecordedPrice !== null && summaryCurrency
                ? ` · Lowest recorded ${formatCurrency(game.summary.lowestRecordedPrice, summaryCurrency)}`
                : ''}
              {game.summary.highestRecordedPrice !== null && summaryCurrency
                ? ` · Highest recorded ${formatCurrency(game.summary.highestRecordedPrice, summaryCurrency)}`
                : ''}
            </p>
            <WishlistButton gameId={game.game.id} gameTitle={game.game.title} />
            <SetAlertButton
              gameId={game.game.id}
              gameSlug={game.game.slug}
              gameTitle={game.game.title}
              listings={game.listings}
            />
          </div>
        </header>

        <section className="detail-panel" aria-labelledby="store-comparison-title">
          <div className="panel-header">
            <h2 id="store-comparison-title">Store comparison</h2>
            <label>
              Sort listings
              <select
                aria-label="Sort store listings"
                value={listingSort}
                onChange={(event) => setListingSort(event.target.value as ListingSort)}
              >
                <option value="price">Cheapest first (within currency)</option>
                <option value="store">Store name</option>
              </select>
            </label>
          </div>
          {listings.length === 0 ? (
            <p>No active store listings are available for this game.</p>
          ) : (
            <div className="table-scroll">
              <table className="store-table" aria-label="Store comparison">
                <thead>
                  <tr>
                    <th scope="col">Store</th>
                    <th scope="col">Price</th>
                    <th scope="col">Regular price</th>
                    <th scope="col">Discount</th>
                    <th scope="col">Last checked</th>
                    <th scope="col">Deal</th>
                  </tr>
                </thead>
                <tbody>
                  {listings.map((listing) => (
                    <tr
                      key={listing.id}
                      className={cheapestListingIds.has(listing.id) ? 'cheapest-listing' : ''}
                    >
                      <th scope="row">
                        {listing.store.name}
                        {cheapestListingIds.has(listing.id) ? (
                          <span className="cheapest-label">Lowest in {listing.currency}</span>
                        ) : null}
                      </th>
                      <td>{formatCurrency(listing.currentPrice, listing.currency)}</td>
                      <td>
                        {listing.regularPrice === null
                          ? '—'
                          : formatCurrency(listing.regularPrice, listing.currency)}
                      </td>
                      <td>
                        {listing.discountPercent === null ? '—' : `${listing.discountPercent}%`}
                      </td>
                      <td>{new Date(listing.lastCheckedAt).toLocaleString()}</td>
                      <td>
                        <a href={listing.dealUrl} target="_blank" rel="noopener noreferrer">
                          View deal
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="detail-panel" aria-labelledby="price-history-title">
          <div className="panel-header">
            <div>
              <h2 id="price-history-title">Price history</h2>
              <p>Prices are shown in separate charts for each currency.</p>
            </div>
            <div className="range-toggle" aria-label="Price history range">
              {historyRanges.map((item) => (
                <button
                  type="button"
                  key={item}
                  aria-pressed={range === item}
                  onClick={() => setRange(item)}
                >
                  {item === 'all' ? 'All' : item}
                </button>
              ))}
            </div>
          </div>
          {historyQuery.isError ? (
            <div className="request-state error-state" role="alert">
              <p>
                Price history could not be loaded:{' '}
                {historyQuery.error instanceof Error ? historyQuery.error.message : 'Unknown error'}
              </p>
              <button
                type="button"
                className="primary-button"
                onClick={() => void historyQuery.refetch()}
              >
                Retry
              </button>
            </div>
          ) : historyQuery.isPending ? (
            <p role="status">Loading price history…</p>
          ) : historyQuery.data ? (
            <PriceHistoryChart history={historyQuery.data} />
          ) : null}
        </section>
      </div>
    </main>
  );
}
