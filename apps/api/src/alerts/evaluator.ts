import type { AlertType } from '@dealhunter/contracts';

export interface AlertToEvaluate {
  id: string;
  gameId: string;
  storeId: string | null;
  alertType: AlertType;
  targetPrice: number | null;
  targetDiscountPercent: number | null;
  currency: string;
  isActive: boolean;
  lastTriggeredAt: Date | null;
  lastConditionMet: boolean | null;
}

export interface ListingToEvaluate {
  id: string;
  gameId: string;
  storeId: string;
  currentPrice: number;
  regularPrice: number | null;
  discountPercent: number | null;
  currency: string;
  isOnSale: boolean;
  lastCheckedAt: Date;
}

export interface SnapshotToEvaluate {
  listingId: string;
  currency: string;
  count: number;
  lowestPrice: number;
}

export interface FiredAlert {
  alert: AlertToEvaluate;
  listing: ListingToEvaluate;
}

export interface AlertStateUpdate {
  alertId: string;
  previousConditionMet: boolean | null;
  conditionMet: boolean;
  shouldFire: boolean;
}

export interface AlertEvaluationResult {
  evaluated: number;
  fired: FiredAlert[];
  stateUpdates: AlertStateUpdate[];
}

const cooldownMilliseconds = 24 * 60 * 60 * 1000;

// Prices are compared only in the alert currency; store-scoped alerts use that
// store, while unscoped alerts use the cheapest matching listing. Historical
// lows require two snapshots. A false/unknown-to-true transition may fire once
// the alert-wide 24-hour cooldown has elapsed.
function conditionIsMet(
  alert: AlertToEvaluate,
  listing: ListingToEvaluate,
  snapshots: readonly SnapshotToEvaluate[],
): boolean {
  switch (alert.alertType) {
    case 'PRICE_BELOW':
      return alert.targetPrice !== null && listing.currentPrice <= alert.targetPrice;
    case 'DISCOUNT_ABOVE':
      return (
        alert.targetDiscountPercent !== null &&
        listing.discountPercent !== null &&
        listing.discountPercent >= alert.targetDiscountPercent
      );
    case 'ANY_SALE':
      return listing.isOnSale;
    case 'HISTORICAL_LOW': {
      const listingSnapshots = snapshots.filter(
        (snapshot) => snapshot.listingId === listing.id && snapshot.currency === alert.currency,
      );
      const snapshotCount = listingSnapshots.reduce((count, snapshot) => count + snapshot.count, 0);
      if (snapshotCount < 2) return false;
      const lowestPrice = Math.min(...listingSnapshots.map((snapshot) => snapshot.lowestPrice));
      return listing.currentPrice <= lowestPrice;
    }
  }
}

export function evaluateAlerts(input: {
  alerts: readonly AlertToEvaluate[];
  listings: readonly ListingToEvaluate[];
  snapshots: readonly SnapshotToEvaluate[];
  changedListingIds?: readonly string[];
  now: Date;
}): AlertEvaluationResult {
  const fired: FiredAlert[] = [];
  const stateUpdates: AlertStateUpdate[] = [];
  let evaluated = 0;
  const changedListingIds = input.changedListingIds ? new Set(input.changedListingIds) : null;

  for (const alert of input.alerts) {
    if (!alert.isActive) continue;

    const candidates = input.listings
      .filter(
        (listing) =>
          listing.gameId === alert.gameId &&
          listing.currency === alert.currency &&
          (alert.storeId === null || listing.storeId === alert.storeId),
      )
      .sort(
        (left, right) => left.currentPrice - right.currentPrice || left.id.localeCompare(right.id),
      );
    const listing = candidates[0];
    if (!listing || (changedListingIds && !changedListingIds.has(listing.id))) continue;

    evaluated += 1;
    const conditionMet = conditionIsMet(alert, listing, input.snapshots);
    const cooldownElapsed =
      alert.lastTriggeredAt === null ||
      input.now.getTime() - alert.lastTriggeredAt.getTime() >= cooldownMilliseconds;
    const shouldFire = conditionMet && alert.lastConditionMet !== true && cooldownElapsed;

    stateUpdates.push({
      alertId: alert.id,
      previousConditionMet: alert.lastConditionMet,
      conditionMet,
      shouldFire,
    });
    if (shouldFire) fired.push({ alert, listing });
  }

  return { evaluated, fired, stateUpdates };
}
