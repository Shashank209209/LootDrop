import type { PrismaClient } from '@prisma/client';
import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createTaxonomyRouter } from './taxonomy-router.js';

const saleFilter = { game: { listings: { some: { isOnSale: true, store: { isActive: true } } } } };

function setup() {
  const database = {
    gameGenre: {
      groupBy: vi.fn(async () => [
        { genreId: '1', _count: { _all: 2 } },
        { genreId: '2', _count: { _all: 0 } },
      ]),
    },
    gamePlatform: { groupBy: vi.fn(async () => [{ platformId: '3', _count: { _all: 1 } }]) },
    genre: {
      findMany: vi.fn(async () => [
        { id: '1', name: 'Indie', slug: 'indie' },
        { id: '2', name: 'Racing', slug: 'racing' },
      ]),
    },
    platform: { findMany: vi.fn(async () => [{ id: '3', name: 'PC', slug: 'pc' }]) },
  };
  const app = express();
  app.use('/api/v1', createTaxonomyRouter(database as unknown as PrismaClient));

  async function request(path: string) {
    const server = app.listen(0);
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not bind');
      const res = await fetch('http://127.0.0.1:' + address.port + '/api/v1/' + path);
      return { status: res.status, body: await res.json() };
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }
  return { database, request };
}

describe('taxonomy routes', () => {
  it('returns one group per genre of games having a live sale and omits zero counts', async () => {
    const { database, request } = setup();
    expect(await request('genres')).toEqual({
      status: 200,
      body: { data: [{ name: 'Indie', slug: 'indie', dealCount: 2 }] },
    });
    expect(database.gameGenre.groupBy).toHaveBeenCalledOnce();
    expect(database.gameGenre.groupBy).toHaveBeenCalledWith({
      by: ['genreId'],
      where: saleFilter,
      _count: { _all: true },
    });
    expect(database.genre.findMany).toHaveBeenCalledOnce();
  });

  it('returns one group per platform of games having a live sale', async () => {
    const { database, request } = setup();
    expect(await request('platforms')).toEqual({
      status: 200,
      body: { data: [{ name: 'PC', slug: 'pc', dealCount: 1 }] },
    });
    expect(database.gamePlatform.groupBy).toHaveBeenCalledOnce();
    expect(database.gamePlatform.groupBy).toHaveBeenCalledWith({
      by: ['platformId'],
      where: saleFilter,
      _count: { _all: true },
    });
    expect(database.platform.findMany).toHaveBeenCalledOnce();
  });

  it('returns an empty array when there are no qualifying games', async () => {
    const { database, request } = setup();
    database.gameGenre.groupBy.mockResolvedValue([]);
    expect(await request('genres')).toEqual({ status: 200, body: { data: [] } });
    expect(database.genre.findMany).not.toHaveBeenCalled();
  });
});
