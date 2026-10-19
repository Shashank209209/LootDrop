import { Prisma } from '@prisma/client';

export interface PriceState {
  currentPrice: Prisma.Decimal | number | string;
  regularPrice: Prisma.Decimal | number | string | null;
  discountPercent: number | null;
  currency: string;
}

function amount(value: PriceState['currentPrice'] | PriceState['regularPrice']): string | null {
  return value === null ? null : new Prisma.Decimal(value).toFixed(2);
}

export function hasPriceChanged(previous: PriceState | null, next: PriceState): boolean {
  if (previous === null) return true;
  return (
    amount(previous.currentPrice) !== amount(next.currentPrice) ||
    amount(previous.regularPrice) !== amount(next.regularPrice) ||
    previous.discountPercent !== next.discountPercent ||
    previous.currency.trim() !== next.currency.trim()
  );
}

export async function capturePriceSnapshotIfChanged(
  transaction: Prisma.TransactionClient,
  listingId: string,
  previous: PriceState | null,
  next: PriceState,
): Promise<boolean> {
  if (!hasPriceChanged(previous, next)) return false;

  await transaction.priceSnapshot.create({
    data: {
      listingId,
      price: new Prisma.Decimal(next.currentPrice),
      regularPrice: next.regularPrice === null ? null : new Prisma.Decimal(next.regularPrice),
      discountPercent: next.discountPercent,
      currency: next.currency,
    },
  });
  return true;
}
