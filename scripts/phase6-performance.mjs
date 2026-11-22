import { Prisma } from '@prisma/client';
import { assertPhase6Test } from './phase6-test-guard.mjs';

assertPhase6Test();
process.env.LOG_LEVEL = 'silent';
const { app, ratesRedis } = await import('../apps/api/src/app.ts');
const { prisma } = await import('../apps/api/src/db/prisma.ts');

const round = (n) => Math.round(n * 100) / 100;
function sequentialScans(node) {
  return [
    ...(node['Node Type'] === 'Seq Scan'
      ? [
          {
            table: node['Relation Name'],
            output: node['Actual Rows'],
            filtered: node['Rows Removed by Filter'] ?? 0,
          },
        ]
      : []),
    ...(node.Plans ?? []).flatMap(sequentialScans),
  ];
}

async function runPlans(game, genre, search) {
  const checks = {
    deals: Prisma.sql`
      SELECT l.id, g.title, s.slug, l.current_price, g.user_rating
      FROM store_listings l JOIN games g ON g.id = l.game_id JOIN stores s ON s.id = l.store_id
      WHERE l.is_on_sale AND s.is_active AND g.title ILIKE ${search}
        AND (${genre ?? null}::text IS NULL OR EXISTS (
          SELECT 1 FROM game_genres link JOIN genres tag ON tag.id = link.genre_id
          WHERE link.game_id = g.id AND tag.slug = ${genre ?? null}
        ))
      ORDER BY g.user_rating DESC NULLS LAST, l.discount_percent DESC NULLS LAST, l.id LIMIT 20`,
    search: Prisma.sql`
      SELECT g.id, g.title, l.current_price FROM games g
      LEFT JOIN store_listings l ON l.game_id = g.id
      WHERE g.title ILIKE ${search} ORDER BY g.title, g.id`,
    gameDetail: Prisma.sql`
      SELECT g.id, l.id, l.current_price FROM games g
      JOIN store_listings l ON l.game_id = g.id JOIN stores s ON s.id = l.store_id
      WHERE g.slug = ${game.slug} AND s.is_active ORDER BY l.currency, l.current_price, s.name, l.id`,
    priceHistory: Prisma.sql`
      SELECT p.listing_id, p.price, p.captured_at FROM price_snapshots p
      JOIN store_listings l ON l.id = p.listing_id JOIN stores s ON s.id = l.store_id
      WHERE l.game_id = ${game.id}::uuid AND s.is_active AND p.captured_at >= now() - interval '90 days'
      ORDER BY p.captured_at`,
    genres: Prisma.sql`
      SELECT x.genre_id, count(*) FROM game_genres x WHERE EXISTS (
        SELECT 1 FROM store_listings l JOIN stores s ON s.id = l.store_id
        WHERE l.game_id = x.game_id AND l.is_on_sale AND s.is_active
      ) GROUP BY x.genre_id`,
    platforms: Prisma.sql`
      SELECT x.platform_id, count(*) FROM game_platforms x WHERE EXISTS (
        SELECT 1 FROM store_listings l JOIN stores s ON s.id = l.store_id
        WHERE l.game_id = x.game_id AND l.is_on_sale AND s.is_active
      ) GROUP BY x.platform_id`,
    alertEvaluation: Prisma.sql`
      SELECT a.id, a.game_id, a.last_condition_met, g.title FROM price_alerts a
      JOIN games g ON g.id = a.game_id WHERE a.is_active AND a.game_id = ${game.id}::uuid`,
  };
  const recorded = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const values = {};
      for (const [name, statement] of Object.entries(checks)) {
        const [row] = await tx.$queryRaw`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`;
        const [result] = row['QUERY PLAN'];
        values[name] = {
          planningMs: result['Planning Time'],
          executionMs: result['Execution Time'],
          seqScans: sequentialScans(result.Plan),
        };
      }
      return values;
    },
    { timeout: 25_000 },
  );
  console.log('Read-only representative SQL plans ' + JSON.stringify(recorded));
  const counts = await Promise.all([
    prisma.game.count(),
    prisma.storeListing.count(),
    prisma.priceSnapshot.count(),
    prisma.priceAlert.count(),
  ]);
  console.log(
    'Table sizes ' +
      JSON.stringify({
        games: counts[0],
        listings: counts[1],
        snapshots: counts[2],
        alerts: counts[3],
      }),
  );
}

async function measure(base, routes) {
  for (const [name, path] of Object.entries(routes)) {
    const call = async () => {
      const start = performance.now();
      const response = await fetch(base + path, { signal: AbortSignal.timeout(5000) });
      await response.arrayBuffer();
      if (response.status !== 200) throw Error(name + ' endpoint returned HTTP ' + response.status);
      return performance.now() - start;
    };
    await call();
    const samples = [];
    for (let batch = 0; batch < 5; batch++) samples.push(...(await Promise.all([call(), call()])));
    samples.sort((a, b) => a - b);
    console.log(
      'HTTP ' +
        name +
        ' ' +
        JSON.stringify({
          requests: samples.length,
          concurrency: 2,
          p50Ms: round((samples[4] + samples[5]) / 2),
          p95Ms: round(samples[9]),
        }),
    );
  }
}

const server = app.listen(0, '127.0.0.1');
try {
  if (!server.listening)
    await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject));
  const base = 'http://127.0.0.1:' + server.address().port;
  const game = await prisma.game.findFirst({
    where: { listings: { some: { isOnSale: true, store: { isActive: true } } } },
    select: {
      id: true,
      title: true,
      slug: true,
      genres: { select: { genre: { select: { slug: true } } }, take: 1 },
    },
    orderBy: { id: 'asc' },
  });
  if (!game) throw Error('Child catalog has no active sale listing to sample');
  const genre =
    game.genres[0]?.genre.slug ??
    (await prisma.genre.findFirst({ orderBy: { slug: 'asc' }, select: { slug: true } }))?.slug;
  const search = game.title.match(/[A-Za-z0-9]{2,}/)?.[0] ?? 'game';
  await runPlans(game, genre, '%' + search + '%');
  const params = new URLSearchParams({
    q: search,
    sort: 'rating_desc',
    ...(genre ? { genre } : {}),
  });
  await measure(base, {
    ready: '/health/ready',
    deals: '/api/v1/deals?' + params,
    search: '/api/v1/games/search?q=' + encodeURIComponent(search),
    detail: '/api/v1/games/' + encodeURIComponent(game.slug),
    history: '/api/v1/games/' + encodeURIComponent(game.slug) + '/price-history?range=90d',
    genres: '/api/v1/genres',
    platforms: '/api/v1/platforms',
  });
} catch (error) {
  console.error(
    'Phase 6 performance check failed: ' +
      (error instanceof Error &&
      /^(Child catalog|[a-z]+ endpoint returned HTTP)/.test(error.message)
        ? error.message
        : 'the guarded read-only queries could not complete'),
  );
  process.exitCode = 1;
} finally {
  await new Promise((resolve) => server.close(resolve));
  ratesRedis.disconnect();
  await prisma.$disconnect();
}
