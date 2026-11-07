import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { searchGames } from '../lib/api-client.js';

export function GameAutocomplete() {
  const [input, setInput] = useState('');
  const [debouncedInput, setDebouncedInput] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedInput(input.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [input]);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);

  const resultsQuery = useQuery({
    queryKey: ['game-search', debouncedInput],
    queryFn: ({ signal }) => searchGames(debouncedInput, signal),
    enabled: open && debouncedInput.length >= 2,
    staleTime: 30_000,
    retry: false,
  });
  const results = resultsQuery.data?.data ?? [];

  const selectGame = (slug: string) => {
    setOpen(false);
    setInput('');
    navigate(`/games/${encodeURIComponent(slug)}`, {
      state: { returnTo: `${location.pathname}${location.search}` },
    });
  };

  return (
    <div className="game-autocomplete" ref={containerRef}>
      <label className="visually-hidden" htmlFor="game-search">
        Search games
      </label>
      <input
        id="game-search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && debouncedInput.length >= 2}
        aria-controls="game-search-results"
        aria-activedescendant={activeIndex >= 0 ? `game-search-option-${activeIndex}` : undefined}
        autoComplete="off"
        value={input}
        placeholder="Find a game..."
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setInput(event.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false);
            setActiveIndex(-1);
          } else if (event.key === 'ArrowDown' && results.length > 0) {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((index) => Math.min(index + 1, results.length - 1));
          } else if (event.key === 'ArrowUp' && results.length > 0) {
            event.preventDefault();
            setActiveIndex((index) => Math.max(index - 1, 0));
          } else if (event.key === 'Enter' && activeIndex >= 0) {
            event.preventDefault();
            const selected = results[activeIndex];
            if (selected) selectGame(selected.slug);
          }
        }}
      />
      {open && debouncedInput.length >= 2 ? (
        <div className="autocomplete-results">
          {resultsQuery.isError ? (
            <p role="status">Game search is unavailable.</p>
          ) : resultsQuery.isPending || resultsQuery.isFetching ? (
            <p role="status">Searching games…</p>
          ) : results.length === 0 ? (
            <p role="status">No games found.</p>
          ) : (
            <ul id="game-search-results" role="listbox" aria-label="Game search results">
              {results.map((game, index) => (
                <li
                  id={`game-search-option-${index}`}
                  key={game.id}
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectGame(game.slug)}
                >
                  <span>{game.title}</span>
                  {game.bestPrice !== null && game.currency ? (
                    <span>
                      {new Intl.NumberFormat(undefined, {
                        style: 'currency',
                        currency: game.currency,
                      }).format(game.bestPrice)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
