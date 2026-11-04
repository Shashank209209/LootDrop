import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { hashSeedPassword } from './seed-password.js';

const seedEnv = z
  .object({
    DEMO_USER_PASSWORD: z.string().min(12),
  })
  .parse(process.env);

const prisma = new PrismaClient();

const stores = [
  { name: 'Steam', slug: 'steam', baseUrl: 'https://store.steampowered.com' },
  { name: 'Epic Games Store', slug: 'epic-games-store', baseUrl: 'https://store.epicgames.com' },
  { name: 'GOG', slug: 'gog', baseUrl: 'https://www.gog.com' },
  { name: 'Humble Store', slug: 'humble-store', baseUrl: 'https://www.humblebundle.com/store' },
  { name: 'Fanatical', slug: 'fanatical', baseUrl: 'https://www.fanatical.com' },
];

const genres = [
  { name: 'Action', slug: 'action' },
  { name: 'Adventure', slug: 'adventure' },
  { name: 'Indie', slug: 'indie' },
  { name: 'RPG', slug: 'rpg' },
  { name: 'Strategy', slug: 'strategy' },
  { name: 'Simulation', slug: 'simulation' },
  { name: 'Sports', slug: 'sports' },
  { name: 'Racing', slug: 'racing' },
];

const platforms = [
  { name: 'PC', slug: 'pc' },
  { name: 'PlayStation 5', slug: 'playstation-5' },
  { name: 'Xbox Series X|S', slug: 'xbox-series-xs' },
  { name: 'Nintendo Switch', slug: 'nintendo-switch' },
  { name: 'macOS', slug: 'macos' },
  { name: 'Linux', slug: 'linux' },
];

async function main() {
  for (const store of stores) {
    await prisma.store.upsert({
      where: { slug: store.slug },
      update: { name: store.name, baseUrl: store.baseUrl, isActive: true },
      create: store,
    });
  }

  for (const genre of genres) {
    await prisma.genre.upsert({
      where: { slug: genre.slug },
      update: { name: genre.name },
      create: genre,
    });
  }

  for (const platform of platforms) {
    await prisma.platform.upsert({
      where: { slug: platform.slug },
      update: { name: platform.name },
      create: platform,
    });
  }

  const passwordHash = await hashSeedPassword(seedEnv.DEMO_USER_PASSWORD);
  await prisma.user.upsert({
    where: { email: 'demo@dealhunter.local' },
    update: { passwordHash, displayName: 'DealHunter Demo' },
    create: {
      email: 'demo@dealhunter.local',
      passwordHash,
      displayName: 'DealHunter Demo',
    },
  });

  console.info(
    `Seeded ${stores.length} stores, ${genres.length} genres, ${platforms.length} platforms, and the demo user.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error('Database seed failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
