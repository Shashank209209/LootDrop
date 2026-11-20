import { useId, useState } from 'react';
import type { GameMetadata } from '@dealhunter/contracts';

export function GameCover({
  title,
  url,
  detail = false,
}: {
  title: string;
  url: string | null;
  detail?: boolean;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const size = detail ? 112 : 92;

  return (
    <div className={detail ? 'deal-cover game-detail-cover' : 'deal-cover'}>
      {url && url !== failedUrl ? (
        <img
          key={url}
          src={url}
          alt={title}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => setFailedUrl(url)}
        />
      ) : (
        <span aria-hidden="true">{title.slice(0, 1) || '?'}</span>
      )}
    </div>
  );
}

export function MetadataTags({ label, items }: { label: string; items: GameMetadata['genres'] }) {
  if (!items?.length) return null;
  return (
    <ul className="metadata-tags" aria-label={label}>
      {items.map(({ name, slug }) => (
        <li key={slug}>{name}</li>
      ))}
    </ul>
  );
}

export function RawgAttribution() {
  return (
    <a className="rawg-attribution" href="https://rawg.io/">
      Game metadata by RAWG
    </a>
  );
}

const descriptionLimit = 280;

export function GameDescription({ description }: { description: string }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const truncated = description.length > descriptionLimit;
  const end = description.lastIndexOf(' ', descriptionLimit);
  const text =
    !truncated || expanded
      ? description
      : description.slice(0, end > descriptionLimit / 2 ? end : descriptionLimit).trimEnd() + '…';

  return (
    <div className="game-description">
      <p id={id}>{text}</p>
      {truncated ? (
        <button
          type="button"
          className="ghost-button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Read less' : 'Read more'}
        </button>
      ) : null}
    </div>
  );
}
