import { Link } from 'react-router-dom';
import type { DealResponse } from '@dealhunter/contracts';
import { WishlistButton } from './WishlistButton.js';

function formatCurrency(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function DealCard({
  deal,
  returnTo = '/',
  lowestRecordedPrice,
}: {
  deal: DealResponse;
  returnTo?: string;
  lowestRecordedPrice?: number;
}) {
  return (
    <article className="deal-card">
      <div className="deal-cover" aria-hidden="true">
        <span>{deal.gameTitle.slice(0, 1) || '?'}</span>
      </div>
      <div className="deal-body">
        <div className="deal-header">
          <div>
            <p className="deal-store">{deal.store.name}</p>
            <h4>
              <Link
                to={`/games/${encodeURIComponent(deal.gameSlug)}`}
                state={{ returnTo }}
                className="game-title-link"
              >
                {deal.gameTitle}
              </Link>
            </h4>
          </div>
          {deal.discountPercent !== null ? (
            <span className={`badge ${deal.isOnSale ? 'sale' : ''}`}>
              {deal.isOnSale ? `${deal.discountPercent}% off` : 'Regular'}
            </span>
          ) : null}
          <WishlistButton gameId={deal.gameId} gameTitle={deal.gameTitle} />
        </div>
        <div className="deal-meta-line">
          <span>{deal.isOnSale ? 'On sale' : 'Regular price'}</span>
          <span>Checked {new Date(deal.lastCheckedAt).toLocaleString()}</span>
        </div>
        {lowestRecordedPrice !== undefined ? (
          <p className="record-low-label">
            Historical low {formatCurrency(lowestRecordedPrice, deal.currency)}
          </p>
        ) : null}
        <div className="price-row">
          <strong>{formatCurrency(deal.currentPrice, deal.currency)}</strong>
          {deal.regularPrice !== null && deal.regularPrice !== deal.currentPrice ? (
            <span>{formatCurrency(deal.regularPrice, deal.currency)}</span>
          ) : null}
        </div>
        <a href={deal.dealUrl} target="_blank" rel="noopener noreferrer">
          View deal
        </a>
      </div>
    </article>
  );
}
