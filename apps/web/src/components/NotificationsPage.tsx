import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, Link } from 'react-router-dom';
import { AccountMenu } from './AccountMenu.js';
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../lib/api-client.js';

function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
}

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = 20;
  const query = useQuery({
    queryKey: ['notifications', 'page', page, pageSize],
    queryFn: ({ signal }) => getNotifications(page, pageSize, false, signal),
    retry: false,
  });
  const readOne = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
        queryClient.invalidateQueries({ queryKey: ['notification-unread-count'] }),
      ]);
    },
  });
  const readAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: async () => {
      queryClient.setQueryData(['notification-unread-count'], 0);
      await queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  return (
    <main className="page-shell">
      <div className="page-inner">
        <header className="topbar">
          <div>
            <p className="eyebrow">DealHunter</p>
            <h1>Notifications</h1>
          </div>
          <AccountMenu />
        </header>
        {query.isPending ? (
          <p role="status" className="request-state">
            Loading notifications…
          </p>
        ) : query.isError ? (
          <div role="alert" className="request-state error-state">
            <p>Notifications could not be loaded.</p>
            <button type="button" className="primary-button" onClick={() => void query.refetch()}>
              Retry
            </button>
          </div>
        ) : query.data.data.length === 0 ? (
          <div className="request-state empty-state">
            <p>No notifications yet.</p>
          </div>
        ) : (
          <>
            <div className="panel-header">
              <p>{query.data.unreadCount} unread</p>
              <button
                type="button"
                className="ghost-button"
                disabled={!query.data.unreadCount || readAll.isPending}
                onClick={() => readAll.mutate()}
              >
                Mark all as read
              </button>
            </div>
            <ul className="full-notification-list">
              {query.data.data.map((notification) => (
                <li key={notification.id} className={notification.readAt ? '' : 'unread'}>
                  <Link
                    to={`/games/${encodeURIComponent(notification.game.slug)}`}
                    onClick={() => {
                      if (notification.readAt === null) readOne.mutate(notification.id);
                    }}
                  >
                    <strong>{notification.game.title}</strong>
                    <span>
                      {formatCurrency(notification.priceAtTrigger, notification.currency)}
                      {notification.store ? ` at ${notification.store.name}` : ''}
                    </span>
                    <time dateTime={notification.createdAt}>
                      {new Date(notification.createdAt).toLocaleString()}
                    </time>
                    <span className="sr-only">{notification.readAt ? 'Read' : 'Unread'}</span>
                  </Link>
                  {notification.readAt === null ? (
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={readOne.isPending}
                      onClick={() => readOne.mutate(notification.id)}
                    >
                      Mark read
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            <nav className="pagination-controls" aria-label="Notification pages">
              <button
                type="button"
                className="ghost-button"
                disabled={page <= 1}
                onClick={() =>
                  setSearchParams(page <= 2 ? new URLSearchParams() : { page: String(page - 1) })
                }
              >
                Previous
              </button>
              <span>
                Page {query.data.pagination.page} of {query.data.pagination.totalPages}
              </span>
              <button
                type="button"
                className="ghost-button"
                disabled={!query.data.pagination.hasNextPage}
                onClick={() => setSearchParams({ page: String(page + 1) })}
              >
                Next
              </button>
            </nav>
          </>
        )}
      </div>
    </main>
  );
}
