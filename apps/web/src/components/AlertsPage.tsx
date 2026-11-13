import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { AlertResponse, AlertsResponse } from '@dealhunter/contracts';
import { AccountMenu } from './AccountMenu.js';
import { AlertDialog } from './AlertDialog.js';
import { deleteAlert, getAlerts, updateAlert } from '../lib/api-client.js';

function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
}

function describeRule(alert: AlertResponse): string {
  const store = alert.store?.name ?? 'Any store';
  switch (alert.alertType) {
    case 'PRICE_BELOW':
      return `Below ${formatCurrency(alert.targetPrice ?? 0, alert.currency)} at ${store}`;
    case 'DISCOUNT_ABOVE':
      return `${alert.targetDiscountPercent ?? 0}% discount at ${store}`;
    case 'ANY_SALE':
      return `Any sale at ${store}`;
    case 'HISTORICAL_LOW':
      return `New all-time low at ${store}`;
  }
}

export function AlertsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = 20;
  const [editing, setEditing] = useState<AlertResponse | null>(null);
  const queryKey = ['alerts', 'page', page, pageSize];
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => getAlerts(page, pageSize, signal),
    retry: false,
  });
  const activeMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updateAlert(id, { isActive }),
    onMutate: async ({ id, isActive }) => {
      await queryClient.cancelQueries({ queryKey: ['alerts'] });
      const previous = queryClient.getQueryData<AlertsResponse>(queryKey);
      queryClient.setQueryData<AlertsResponse>(queryKey, (current) =>
        current
          ? {
              ...current,
              data: current.data.map((alert) => (alert.id === id ? { ...alert, isActive } : alert)),
            }
          : current,
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteAlert,
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['alerts'] });
      const previous = queryClient.getQueryData<AlertsResponse>(queryKey);
      queryClient.setQueryData<AlertsResponse>(queryKey, (current) =>
        current
          ? {
              ...current,
              data: current.data.filter((alert) => alert.id !== id),
              pagination: {
                ...current.pagination,
                totalItems: Math.max(0, current.pagination.totalItems - 1),
              },
            }
          : current,
      );
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });

  const updatePage = (nextPage: number) => {
    setSearchParams(nextPage <= 1 ? new URLSearchParams() : { page: String(nextPage) });
  };

  return (
    <main className="page-shell">
      <div className="page-inner">
        <header className="topbar">
          <div>
            <p className="eyebrow">DealHunter</p>
            <h1>Price alerts</h1>
          </div>
          <AccountMenu />
        </header>
        {query.isPending ? (
          <p role="status" className="request-state">
            Loading your alerts…
          </p>
        ) : query.isError ? (
          <div className="request-state error-state" role="alert">
            <p>Your alerts could not be loaded.</p>
            <button type="button" className="primary-button" onClick={() => void query.refetch()}>
              Retry
            </button>
          </div>
        ) : query.data.data.length === 0 ? (
          <div className="request-state empty-state">
            <p>You have no price alerts yet.</p>
            <Link className="primary-button" to="/">
              Browse games
            </Link>
          </div>
        ) : (
          <>
            <section className="alert-list" aria-label="Your price alerts">
              {query.data.data.map((alert) => {
                const status = alert.lastTriggeredAt
                  ? `Triggered ${new Date(alert.lastTriggeredAt).toLocaleString()}`
                  : alert.isActive
                    ? 'Watching'
                    : 'Paused';
                return (
                  <article className="alert-entry" key={alert.id}>
                    <div className="alert-entry-main">
                      <h2>
                        <Link to={`/games/${encodeURIComponent(alert.game.slug)}`}>
                          {alert.game.title}
                        </Link>
                      </h2>
                      <p>{describeRule(alert)}</p>
                      <p
                        className={
                          alert.lastTriggeredAt ? 'alert-status triggered' : 'alert-status'
                        }
                      >
                        {status}
                      </p>
                      <strong>
                        {alert.current
                          ? formatCurrency(alert.current.currentPrice, alert.current.currency)
                          : 'No current price'}
                      </strong>
                    </div>
                    <div className="alert-entry-actions">
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => setEditing(alert)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={activeMutation.isPending}
                        onClick={() =>
                          activeMutation.mutate({ id: alert.id, isActive: !alert.isActive })
                        }
                      >
                        {alert.isActive ? 'Pause' : 'Resume'}
                      </button>
                      <button
                        type="button"
                        className="ghost-button danger-button"
                        disabled={deleteMutation.isPending}
                        onClick={() => {
                          if (window.confirm(`Delete the alert for ${alert.game.title}?`)) {
                            deleteMutation.mutate(alert.id);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                );
              })}
            </section>
            <nav className="pagination-controls" aria-label="Alert pages">
              <button
                type="button"
                className="ghost-button"
                onClick={() => updatePage(page - 1)}
                disabled={page <= 1}
              >
                Previous
              </button>
              <span>
                Page {query.data.pagination.page} of {query.data.pagination.totalPages}
              </span>
              <button
                type="button"
                className="ghost-button"
                onClick={() => updatePage(page + 1)}
                disabled={!query.data.pagination.hasNextPage}
              >
                Next
              </button>
            </nav>
          </>
        )}
      </div>
      {editing ? (
        <AlertDialog
          gameId={editing.game.id}
          gameSlug={editing.game.slug}
          gameTitle={editing.game.title}
          initialAlert={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {activeMutation.isError || deleteMutation.isError ? (
        <p role="alert" className="request-state error-state">
          The alert change could not be saved. Your previous state was restored.
        </p>
      ) : null}
    </main>
  );
}
