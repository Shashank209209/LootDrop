import type { TaxonomyResponse } from '@dealhunter/contracts';

export function TaxonomyFilter({
  label,
  options,
  selected,
  max,
  onToggle,
}: {
  label: string;
  options: TaxonomyResponse['data'];
  selected: string[];
  max: number;
  onToggle: (slug: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <fieldset className="taxonomy-filter">
      <legend>{label}</legend>
      {options.map(({ slug, name, dealCount }) => {
        const checked = selected.includes(slug);
        return (
          <label className="taxonomy-option" key={slug}>
            <input
              type="checkbox"
              aria-label={`${name}, ${dealCount} ${dealCount === 1 ? 'game' : 'games'} on sale`}
              checked={checked}
              disabled={!checked && selected.length >= max}
              onChange={() => onToggle(slug)}
            />
            <span>{name}</span>
            <span className="taxonomy-count">{dealCount}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
