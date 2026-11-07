// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PriceHistoryResponse } from '@dealhunter/contracts';
import { PriceHistoryChart } from './PriceHistoryChart.js';

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(() => cleanup());

function history(points: PriceHistoryResponse['data'][number]['points']): PriceHistoryResponse {
  return {
    data: [
      {
        listingId: 'listing-1',
        store: { id: 'store-1', name: 'Steam', slug: 'steam' },
        currency: 'USD',
        points,
      },
    ],
    range: { from: null, to: '2026-01-01T00:00:00.000Z' },
  };
}

describe('PriceHistoryChart', () => {
  it('renders a responsive chart summary for a long history', () => {
    const points = Array.from({ length: 366 }, (_, index) => ({
      capturedAt: new Date(Date.UTC(2025, 0, index + 1)).toISOString(),
      price: index === 150 ? 0.99 : index + 1,
      regularPrice: 40,
      discountPercent: 50,
    }));
    render(<PriceHistoryChart history={history(points)} />);

    expect(screen.getByTestId('price-chart-USD').getAttribute('aria-label')).toContain(
      '366 price observations',
    );
    expect(screen.getByTestId('price-chart-USD').getAttribute('aria-label')).toContain(
      'Lowest recorded',
    );
  });

  it('renders a one-point history as a chart with a single observation', () => {
    render(
      <PriceHistoryChart
        history={history([
          {
            capturedAt: '2026-01-01T00:00:00.000Z',
            price: 4.99,
            regularPrice: null,
            discountPercent: null,
          },
        ])}
      />,
    );

    expect(screen.getByTestId('price-chart-USD').getAttribute('aria-label')).toContain(
      '1 price observation',
    );
  });

  it('shows an explicit message when there are no history points', () => {
    render(<PriceHistoryChart history={history([])} />);
    expect(screen.getByText('Price history builds up as we keep tracking this game.')).toBeTruthy();
    expect(screen.queryByTestId('price-chart-USD')).toBeNull();
  });
});
