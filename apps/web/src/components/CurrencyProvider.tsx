import { createContext, useContext, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  displayCurrencies,
  displayCurrencySchema,
  type DisplayCurrency,
  type RatesResponse,
} from '@dealhunter/contracts';
import { useAuth } from '../auth/AuthProvider.js';
import { getMe, getRates, saveCurrencyPreference } from '../lib/api-client.js';
import { readGuestCurrency, writeGuestCurrency } from '../lib/currency.js';

type CurrencyContextValue = {
  currency: DisplayCurrency;
  rates: RatesResponse | undefined;
  ratesUnavailable: boolean;
  select: (currency: DisplayCurrency) => void;
  pending: boolean;
  saveFailed: boolean;
};

const CurrencyContext = createContext<CurrencyContextValue | null>(null);
const preferenceKey = (userId: string | null) => ['currency-preference', userId];

function useRates() {
  return useQuery({
    queryKey: ['rates'],
    queryFn: ({ signal }) => getRates(signal),
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [guestCurrency, setGuestCurrency] = useState(readGuestCurrency);
  const { state } = useAuth();
  const queryClient = useQueryClient();
  const accountId = state.user?.id ?? null;
  const rates = useRates();
  const preference = useQuery({
    queryKey: preferenceKey(accountId),
    enabled: accountId !== null,
    retry: false,
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const { user } = await getMe(signal);
      if (user.id !== accountId) throw new Error('The account changed while loading preferences');
      return user.preferredCurrency;
    },
  });

  const update = useMutation({
    mutationFn: ({ currency }: { userId: string; currency: DisplayCurrency }) =>
      saveCurrencyPreference(currency),
    onMutate: async ({ userId, currency }) => {
      const key = preferenceKey(userId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<DisplayCurrency>(key) ?? 'USD';
      queryClient.setQueryData(key, currency);
      return { previous };
    },
    onError: (_error, { userId }, rollback) => {
      const key = preferenceKey(userId);
      if (rollback && queryClient.getQueryState(key))
        queryClient.setQueryData(key, rollback.previous);
    },
    onSuccess: (saved, { userId }) => {
      const key = preferenceKey(userId);
      if (queryClient.getQueryState(key)) queryClient.setQueryData(key, saved.preferredCurrency);
    },
  });

  const pending =
    accountId !== null &&
    (preference.isPending || (update.isPending && update.variables?.userId === accountId));
  const currency = accountId === null ? guestCurrency : (preference.data ?? 'USD');
  const select = (next: DisplayCurrency) => {
    if (pending || next === currency) return;
    if (accountId === null) {
      setGuestCurrency(next);
      writeGuestCurrency(next);
    } else {
      update.mutate({ userId: accountId, currency: next });
    }
  };

  return (
    <CurrencyContext.Provider
      value={{
        currency,
        rates: rates.data,
        ratesUnavailable: rates.isError && !rates.data,
        select,
        pending,
        saveFailed: update.isError && update.variables?.userId === accountId,
      }}
    >
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (!context) throw new Error('useCurrency requires CurrencyProvider');
  return context;
}

export function CurrencySelector() {
  const { currency, select, pending, saveFailed, ratesUnavailable } = useCurrency();
  return (
    <div className="currency-control">
      <label>
        Currency
        <select
          value={currency}
          disabled={pending}
          onChange={(event) => {
            const selected = displayCurrencySchema.safeParse(event.currentTarget.value);
            if (selected.success) select(selected.data);
          }}
        >
          {displayCurrencies.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </label>
      {ratesUnavailable ? (
        <span className="currency-notice" role="status">
          Exchange rates unavailable, showing original prices
        </span>
      ) : null}
      {saveFailed ? (
        <span role="alert" className="inline-error">
          Currency preference could not be saved.
        </span>
      ) : null}
    </div>
  );
}
