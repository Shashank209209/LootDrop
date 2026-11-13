import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createAlertRequestSchema,
  type AlertResponse,
  type CreateAlertRequest,
  type GameDetailResponse,
} from '@dealhunter/contracts';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ApiError, createAlert, getGame, updateAlert } from '../lib/api-client.js';

type GameListing = GameDetailResponse['data']['listings'][number];
type AlertKind = CreateAlertRequest['alertType'];

const alertKinds: Array<{ value: AlertKind; label: string }> = [
  { value: 'PRICE_BELOW', label: 'Price drops below' },
  { value: 'DISCOUNT_ABOVE', label: 'Discount reaches' },
  { value: 'ANY_SALE', label: 'Any sale starts' },
  { value: 'HISTORICAL_LOW', label: 'New all-time low' },
];

function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
}

function initialKind(alert?: AlertResponse): AlertKind {
  return alert?.alertType ?? 'PRICE_BELOW';
}

function currentFor(
  listings: readonly GameListing[],
  storeId: string,
  currency: string,
): GameListing | undefined {
  return listings
    .filter(
      (listing) => listing.currency === currency && (!storeId || listing.store.id === storeId),
    )
    .sort(
      (left, right) =>
        left.currentPrice - right.currentPrice || left.store.id.localeCompare(right.store.id),
    )[0];
}

export function AlertDialog({
  gameId,
  gameSlug,
  gameTitle,
  listings: suppliedListings,
  initialAlert,
  onClose,
}: {
  gameId: string;
  gameSlug: string;
  gameTitle: string;
  listings?: readonly GameListing[];
  initialAlert?: AlertResponse;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [kind, setKind] = useState<AlertKind>(initialKind(initialAlert));
  const [storeId, setStoreId] = useState(initialAlert?.store?.id ?? '');
  const [targetPrice, setTargetPrice] = useState(initialAlert?.targetPrice?.toString() ?? '');
  const [targetDiscount, setTargetDiscount] = useState(
    initialAlert?.targetDiscountPercent?.toString() ?? '',
  );
  const [fieldError, setFieldError] = useState('');
  const [requestError, setRequestError] = useState('');
  const [saved, setSaved] = useState(false);
  const gameQuery = useQuery({
    queryKey: ['game', gameSlug],
    queryFn: ({ signal }) => getGame(gameSlug, signal),
    enabled: suppliedListings === undefined,
    retry: false,
  });
  const listings = suppliedListings ?? gameQuery.data?.data.listings ?? [];
  const currency =
    initialAlert?.currency ??
    listings.find((listing) => !storeId || listing.store.id === storeId)?.currency ??
    'USD';
  const current = useMemo(
    () => currentFor(listings, storeId, currency),
    [currency, listings, storeId],
  );
  const createMutation = useMutation({
    mutationFn: createAlert,
    onSuccess: async () => {
      setSaved(true);
      setRequestError('');
      await queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
    onError: (error: unknown) => {
      setRequestError(
        error instanceof ApiError && error.status === 409
          ? 'This alert already exists.'
          : error instanceof Error
            ? error.message
            : 'The alert could not be saved.',
      );
    },
  });
  const updateMutation = useMutation({
    mutationFn: (input: { targetPrice?: number; targetDiscountPercent?: number }) =>
      updateAlert(initialAlert!.id, input),
    onSuccess: async () => {
      setSaved(true);
      setRequestError('');
      await queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
    onError: (error: unknown) => {
      setRequestError(error instanceof Error ? error.message : 'The alert could not be saved.');
    },
  });
  const pending = createMutation.isPending || updateMutation.isPending;
  const alreadyMet =
    current &&
    ((kind === 'PRICE_BELOW' &&
      targetPrice !== '' &&
      Number(targetPrice) > 0 &&
      current.currentPrice <= Number(targetPrice)) ||
      (kind === 'DISCOUNT_ABOVE' &&
        targetDiscount !== '' &&
        current.discountPercent !== null &&
        current.discountPercent >= Number(targetDiscount)) ||
      (kind === 'ANY_SALE' && current.isOnSale));

  useEffect(() => {
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = dialogRef.current?.querySelector<HTMLElement>(
      'input:not(:disabled), select:not(:disabled), button:not(:disabled)',
    );
    first?.focus();
    return () => previousFocus.current?.focus();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    );
    if (!items?.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFieldError('');
    setRequestError('');
    setSaved(false);
    if (kind === 'PRICE_BELOW') {
      const parsed = Number(targetPrice);
      if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed * 100)) {
        setFieldError('Enter a price greater than zero with at most two decimal places.');
        return;
      }
      if (initialAlert) updateMutation.mutate({ targetPrice: parsed });
      else {
        const request = createAlertRequestSchema.safeParse({
          gameId,
          ...(storeId ? { storeId } : {}),
          currency,
          alertType: kind,
          targetPrice: parsed,
        });
        if (!request.success) {
          setFieldError(request.error.issues[0]?.message ?? 'Enter a valid target price.');
          return;
        }
        createMutation.mutate(request.data);
      }
      return;
    }
    if (kind === 'DISCOUNT_ABOVE') {
      const parsed = Number(targetDiscount);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
        setFieldError('Enter a whole-number discount from 1 to 100.');
        return;
      }
      if (initialAlert) updateMutation.mutate({ targetDiscountPercent: parsed });
      else {
        const request = createAlertRequestSchema.safeParse({
          gameId,
          ...(storeId ? { storeId } : {}),
          currency,
          alertType: kind,
          targetDiscountPercent: parsed,
        });
        if (!request.success) {
          setFieldError(request.error.issues[0]?.message ?? 'Enter a valid discount.');
          return;
        }
        createMutation.mutate(request.data);
      }
      return;
    }
    if (initialAlert) {
      setFieldError('This alert type has no editable target.');
      return;
    }
    const request = createAlertRequestSchema.safeParse({
      gameId,
      ...(storeId ? { storeId } : {}),
      currency,
      alertType: kind,
    });
    if (!request.success) {
      setFieldError(request.error.issues[0]?.message ?? 'The alert is invalid.');
      return;
    }
    createMutation.mutate(request.data);
  };

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="alert-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="alert-dialog-title"
        onKeyDown={handleKeyDown}
      >
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">{initialAlert ? 'Edit alert' : 'Price alert'}</p>
            <h2 id="alert-dialog-title">{gameTitle}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close alert dialog"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {gameQuery.isError ? <p role="alert">Game listings could not be loaded.</p> : null}
        <form className="alert-form" onSubmit={handleSubmit} noValidate>
          <fieldset>
            <legend>Alert type</legend>
            {alertKinds.map((option) => (
              <label className="alert-radio-option" key={option.value}>
                <input
                  type="radio"
                  name="alertType"
                  value={option.value}
                  checked={kind === option.value}
                  disabled={Boolean(initialAlert)}
                  onChange={() => {
                    setKind(option.value);
                    setFieldError('');
                  }}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </fieldset>
          {kind === 'PRICE_BELOW' ? (
            <label htmlFor="alert-target-price">
              Target price ({currency})
              <input
                id="alert-target-price"
                type="number"
                min="0.01"
                step="0.01"
                value={targetPrice}
                onChange={(event) => setTargetPrice(event.target.value)}
                aria-invalid={Boolean(fieldError)}
                aria-describedby={fieldError ? 'alert-field-error' : undefined}
              />
            </label>
          ) : null}
          {kind === 'DISCOUNT_ABOVE' ? (
            <label htmlFor="alert-target-discount">
              Target discount (%)
              <input
                id="alert-target-discount"
                type="number"
                min="1"
                max="100"
                step="1"
                value={targetDiscount}
                onChange={(event) => setTargetDiscount(event.target.value)}
                aria-invalid={Boolean(fieldError)}
                aria-describedby={fieldError ? 'alert-field-error' : undefined}
              />
            </label>
          ) : null}
          {!initialAlert ? (
            <label htmlFor="alert-store">
              Store
              <select
                id="alert-store"
                value={storeId}
                onChange={(event) => setStoreId(event.target.value)}
              >
                <option value="">Any store</option>
                {[
                  ...new Map(listings.map((listing) => [listing.store.id, listing.store])).values(),
                ].map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <p className="alert-current-price" aria-live="polite">
            {current
              ? `Current price: ${formatCurrency(current.currentPrice, current.currency)} at ${current.store.name}`
              : 'No current price is available for this store.'}
            {alreadyMet ? ' — already met at the current price.' : ''}
          </p>
          {fieldError ? (
            <p id="alert-field-error" className="field-error" role="alert">
              {fieldError}
            </p>
          ) : null}
          {requestError ? (
            <p className="field-error" role="alert">
              {requestError}
            </p>
          ) : null}
          {saved ? <p role="status">Alert saved successfully.</p> : null}
          <div className="dialog-actions">
            <button type="button" className="ghost-button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={pending}>
              {pending ? 'Saving…' : initialAlert ? 'Save changes' : 'Set alert'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
