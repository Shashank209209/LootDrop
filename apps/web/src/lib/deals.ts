export type Deal = {
  id: string;
  title: string;
  store: string;
  price: number;
  regularPrice: number;
  discountPercent: number;
  isOnSale: boolean;
  image: string | null;
  url: string;
  genre: string;
  releaseLabel: string;
  rating: number;
};

export type DealSummary = {
  totalDeals: number;
  onSaleCount: number;
  averageDiscount: number;
  cheapestPrice: number;
  bestDeal: Deal | null;
};

export const demoDeals: Deal[] = [
  {
    id: 'deal-1',
    title: 'Hades',
    store: 'Steam',
    price: 6.99,
    regularPrice: 19.99,
    discountPercent: 65,
    isOnSale: true,
    image: null,
    url: 'https://store.steampowered.com/app/1145360/Hades/',
    genre: 'Action Roguelike',
    releaseLabel: 'New release',
    rating: 4.9,
  },
  {
    id: 'deal-2',
    title: 'Stardew Valley',
    store: 'Steam',
    price: 4.99,
    regularPrice: 14.99,
    discountPercent: 67,
    isOnSale: true,
    image: null,
    url: 'https://store.steampowered.com/app/413150/Stardew_Valley/',
    genre: 'Simulation',
    releaseLabel: 'Popular now',
    rating: 4.8,
  },
  {
    id: 'deal-3',
    title: 'Cyberpunk 2077',
    store: 'Epic',
    price: 39.99,
    regularPrice: 59.99,
    discountPercent: 33,
    isOnSale: true,
    image: null,
    url: 'https://store.epicgames.com/en-US/p/cyberpunk-2077',
    genre: 'Open World',
    releaseLabel: 'Featured drop',
    rating: 4.5,
  },
  {
    id: 'deal-4',
    title: "Baldur's Gate 3",
    store: 'GOG',
    price: 49.99,
    regularPrice: 49.99,
    discountPercent: 0,
    isOnSale: false,
    image: null,
    url: 'https://www.gog.com/en/game/baldurs_gate_3',
    genre: 'RPG',
    releaseLabel: 'Top ranked',
    rating: 4.9,
  },
  {
    id: 'deal-5',
    title: 'Portal 2',
    store: 'Steam',
    price: 2.49,
    regularPrice: 9.99,
    discountPercent: 75,
    isOnSale: true,
    image: null,
    url: 'https://store.steampowered.com/app/620/Portal_2/',
    genre: 'Puzzle',
    releaseLabel: 'Weekend special',
    rating: 4.7,
  },
  {
    id: 'deal-6',
    title: 'Red Dead Redemption 2',
    store: 'Epic',
    price: 29.99,
    regularPrice: 59.99,
    discountPercent: 50,
    isOnSale: true,
    image: null,
    url: 'https://store.epicgames.com/en-US/p/red-dead-redemption-2',
    genre: 'Adventure',
    releaseLabel: 'Editor pick',
    rating: 4.8,
  },
];

export function summarizeDeals(deals: Deal[]): DealSummary {
  if (deals.length === 0) {
    return {
      totalDeals: 0,
      onSaleCount: 0,
      averageDiscount: 0,
      cheapestPrice: 0,
      bestDeal: null,
    };
  }

  const onSaleDeals = deals.filter((deal) => deal.isOnSale);
  const averageDiscount = Math.round(
    onSaleDeals.reduce((sum, deal) => sum + deal.discountPercent, 0) / onSaleDeals.length,
  );
  const cheapestPrice = Math.min(...deals.map((deal) => deal.price));
  const bestDeal =
    [...onSaleDeals].sort((a, b) => b.discountPercent - a.discountPercent)[0] ?? null;

  return {
    totalDeals: deals.length,
    onSaleCount: onSaleDeals.length,
    averageDiscount: Number.isFinite(averageDiscount) ? averageDiscount : 0,
    cheapestPrice,
    bestDeal,
  };
}
