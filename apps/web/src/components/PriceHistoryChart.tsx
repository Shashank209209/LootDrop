import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { PriceHistoryResponse } from '@dealhunter/contracts';

const lineStyles = [
  { color: '#155e75', dash: '' },
  { color: '#7c2d12', dash: '7 3' },
  { color: '#4c1d95', dash: '2 3' },
  { color: '#166534', dash: '9 3 2 3' },
  { color: '#9f1239', dash: '5 2' },
  { color: '#334155', dash: '1 3' },
];

function formatCurrency(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

type Props = { history: PriceHistoryResponse };

export function PriceHistoryChart({ history }: Props) {
  const listings = history.data.filter((entry) => entry.points.length > 0);
  if (listings.length === 0) {
    return <p className="history-empty">Price history builds up as we keep tracking this game.</p>;
  }

  const currencies = [...new Set(listings.map((entry) => entry.currency))].sort();
  return (
    <div className="history-charts">
      {currencies.map((currency) => {
        const currencyListings = listings.filter((entry) => entry.currency === currency);
        const times = [
          ...new Set(
            currencyListings.flatMap((entry) => entry.points.map((point) => point.capturedAt)),
          ),
        ].sort();
        const data = times.map((capturedAt) => {
          const row: Record<string, string | number> = { capturedAt };
          for (const entry of currencyListings) {
            const point = entry.points.find((candidate) => candidate.capturedAt === capturedAt);
            if (point) row[entry.listingId] = point.price;
          }
          return row;
        });
        const lowestPrice = Math.min(
          ...currencyListings.flatMap((entry) => entry.points.map((point) => point.price)),
        );
        const lowestPoint = currencyListings
          .flatMap((entry) => entry.points.map((point) => ({ point, store: entry.store.name })))
          .find(({ point }) => point.price === lowestPrice);
        const pointCount = currencyListings.reduce(
          (count, entry) => count + entry.points.length,
          0,
        );
        const chartSummary = `${pointCount} price observations in ${currency} across ${currencyListings.length} store${currencyListings.length === 1 ? '' : 's'}. Lowest recorded price ${formatCurrency(lowestPrice, currency)}${lowestPoint ? ` at ${lowestPoint.store} on ${new Date(lowestPoint.point.capturedAt).toLocaleDateString()}` : ''}.`;

        return (
          <section className="history-chart-section" key={currency}>
            <h3>{currency}</h3>
            <p className="visually-hidden">{chartSummary}</p>
            <div
              className="history-chart"
              role="img"
              aria-label={chartSummary}
              data-testid={`price-chart-${currency}`}
            >
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={data} margin={{ top: 12, right: 12, bottom: 8, left: 8 }}>
                  <CartesianGrid stroke="#d4d4d8" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="capturedAt"
                    tickFormatter={(value: string) => new Date(value).toLocaleDateString()}
                    minTickGap={24}
                  />
                  <YAxis
                    width={76}
                    tickFormatter={(value: number) => formatCurrency(value, currency)}
                  />
                  <Tooltip
                    labelFormatter={(value) => new Date(String(value)).toLocaleString()}
                    formatter={(value, name) => [
                      formatCurrency(Number(value), currency),
                      String(name),
                    ]}
                  />
                  <ReferenceLine
                    y={lowestPrice}
                    stroke="#b91c1c"
                    strokeDasharray="6 4"
                    label={{
                      value: `Lowest ${formatCurrency(lowestPrice, currency)}`,
                      position: 'insideTopRight',
                      fill: '#991b1b',
                    }}
                  />
                  {currencyListings.map((entry, index) => {
                    const style = lineStyles[index % lineStyles.length]!;
                    return (
                      <Line
                        key={entry.listingId}
                        type="stepAfter"
                        dataKey={entry.listingId}
                        name={entry.store.name}
                        stroke={style.color}
                        strokeDasharray={style.dash}
                        strokeWidth={2}
                        dot={entry.points.length === 1 ? { r: 5, strokeWidth: 2 } : false}
                        activeDot={{ r: 5 }}
                        connectNulls
                      />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        );
      })}
    </div>
  );
}
