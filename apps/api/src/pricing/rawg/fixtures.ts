export const rawgSearchFixture = {
  results: [
    { id: 123, name: 'Celeste', slug: 'celeste' },
    { id: 124, name: 'Celeste Classic', slug: 'celeste-classic' },
  ],
};

export const rawgDetailFixture = {
  id: 123,
  name: 'Celeste',
  background_image: 'https://media.rawg.io/games/celeste.jpg',
  description_raw: 'A challenging platformer about climbing a mountain.',
  released: '2018-01-25',
  metacritic: 91,
  rating: 4.2,
  genres: [{ id: 1, name: 'Indie', slug: 'indie' }],
  platforms: [{ platform: { id: 4, name: 'PC', slug: 'pc' } }],
};
