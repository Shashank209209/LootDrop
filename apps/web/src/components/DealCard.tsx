import { Link } from 'react-router-dom';
import type { DealResponse } from '@lootdrop/contracts';
import { WishlistButton } from './WishlistButton.js';
import { GameCover, MetadataTags } from './GameMedia.js';
import { DisplayPrice } from './DisplayPrice.js';

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
      <GameCover title={deal.gameTitle} url={deal.coverUrl} />
      <div className="deal-body">
        <div className="deal-header">
          <div>
            <p className="deal-store">{deal.store.name}</p>
            <h3>
              <Link
                to={`/games/${encodeURIComponent(deal.gameSlug)}`}
                state={{ returnTo }}
                className="game-title-link"
              >
                {deal.gameTitle}
              </Link>
            </h3>
          </div>
          {deal.discountPercent !== null ? (
            <span className={`badge ${deal.isOnSale ? 'sale' : ''}`}>
              {deal.isOnSale ? `${deal.discountPercent}% off` : 'Regular'}
            </span>
          ) : null}
          <WishlistButton gameId={deal.gameId} gameTitle={deal.gameTitle} />
        </div>
        <MetadataTags label="Genres" items={deal.genres} />
        {deal.userRating != null || deal.releaseDate ? (
          <div className="metadata-facts">
            {deal.userRating != null ? <span>RAWG {deal.userRating}/5</span> : null}
            {deal.releaseDate ? (
              <time dateTime={deal.releaseDate}>{deal.releaseDate.slice(0, 4)}</time>
            ) : null}
          </div>
        ) : null}
        <div className="deal-meta-line">
          <span>{deal.isOnSale ? 'On sale' : 'Regular price'}</span>
          <span>Checked {new Date(deal.lastCheckedAt).toLocaleString()}</span>
        </div>
        {lowestRecordedPrice !== undefined ? (
          <p className="record-low-label">
            Historical low <DisplayPrice amount={lowestRecordedPrice} original={deal.currency} />
          </p>
        ) : null}
        <div className="price-row">
          <strong>
            <DisplayPrice amount={deal.currentPrice} original={deal.currency} />
          </strong>
          {deal.regularPrice !== null && deal.regularPrice !== deal.currentPrice ? (
            <span>
              <DisplayPrice amount={deal.regularPrice} original={deal.currency} />
            </span>
          ) : null}
        </div>
        <a href={deal.dealUrl} target="_blank" rel="noopener noreferrer">
          View deal
        </a>
      </div>
    </article>
  );
}
