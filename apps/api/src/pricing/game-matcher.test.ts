import { describe, expect, it } from 'vitest';
import { findMatchingGame, normalizeGameTitle } from './game-matcher.js';

describe('normalizeGameTitle', () => {
  it('normalizes punctuation, marks, accents, and edition wording', () => {
    expect(normalizeGameTitle('Pokémon™: Deluxe Edition')).toBe('pokemon');
    expect(normalizeGameTitle('The Witcher 3: Game of the Year')).toBe('the witcher 3');
  });
});

describe('findMatchingGame', () => {
  const candidates = [
    { id: 'steam', normalizedTitle: 'same title', steamAppId: 42 },
    { id: 'title', normalizedTitle: 'same title', steamAppId: null },
  ];

  it('matches by Steam app id when supplied', () => {
    expect(findMatchingGame(candidates, { title: 'Different Name', steamAppId: 42 })?.id).toBe(
      'steam',
    );
  });

  it('uses normalized title only when no Steam app id is available', () => {
    expect(findMatchingGame(candidates, { title: 'Same Title!', steamAppId: null })?.id).toBe(
      'steam',
    );
  });

  it('does not fall back to title when an unmatched Steam app id exists', () => {
    expect(findMatchingGame(candidates, { title: 'Same Title', steamAppId: 99 })).toBeNull();
  });
});
