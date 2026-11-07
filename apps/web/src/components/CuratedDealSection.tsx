import type { DealResponse, HistoricalLowDeal } from '@dealhunter/contracts';
import { DealCard } from './DealCard.js';

type Props = {
  title: string;
  data: DealResponse[] | HistoricalLowDeal[] | undefined;
  isPending: boolean;
  isError: boolean;
  error?: unknown;
  returnTo: string;
  onRetry: () => void;
};

export function CuratedDealSection({
  title,
  data,
  isPending,
  isError,
  error,
  returnTo,
  onRetry,
}: Props) {
  if (!isPending && !isError && data?.length === 0) return null;

  return (
    <section className="curated-section" aria-label={title} aria-busy={isPending}>
      <div className="panel-header">
        <h2>{title}</h2>
        {isPending ? <span>Loading…</span> : null}
      </div>
      {isError ? (
        <div className="curated-error" role="alert">
          <p>
            {title} could not be loaded: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
          <button type="button" className="ghost-button" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : isPending ? (
        <div className="curated-skeletons" role="status" aria-label={`Loading ${title}`}>
          <span />
          <span />
          <span />
        </div>
      ) : (
        <div className="curated-grid">
          {data?.map((deal) => (
            <DealCard
              key={deal.id}
              deal={deal}
              returnTo={returnTo}
              {...('lowestRecordedPrice' in deal
                ? { lowestRecordedPrice: deal.lowestRecordedPrice }
                : {})}
            />
          ))}
        </div>
      )}
    </section>
  );
}
