import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import {
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '../lib/api-client.js';

export function NotificationBell() {
  const { state } = useAuth();
  const queryClient = useQueryClient();
  const authenticated = state.status === 'authenticated';
  const [visible, setVisible] = useState(
    typeof document === 'undefined' || document.visibilityState === 'visible',
  );
  const [open, setOpen] = useState(false);
  const countQuery = useQuery({
    queryKey: ['notification-unread-count'],
    queryFn: ({ signal }) => getUnreadNotificationCount(signal),
    enabled: authenticated && visible,
    refetchInterval: authenticated && visible ? 60_000 : false,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const listQuery = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: ({ signal }) => getNotifications(1, 5, false, signal),
    enabled: authenticated && open,
    retry: false,
  });
  const readMutation = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
        queryClient.invalidateQueries({ queryKey: ['notification-unread-count'] }),
      ]);
    },
  });
  const readAllMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: async () => {
      queryClient.setQueryData(['notification-unread-count'], 0);
      await queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  useEffect(() => {
    const updateVisibility = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);

  if (!authenticated) return null;
  const unreadCount = countQuery.data ?? 0;
  const unreadLabel = `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`;

  return (
    <div className="notification-bell-wrap">
      <button
        type="button"
        className="notification-bell"
        aria-label={`Notifications, ${unreadLabel}`}
        aria-expanded={open}
        aria-controls="notification-popover"
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">♢</span>
        {unreadCount > 0 ? <span className="notification-badge">{unreadCount}</span> : null}
      </button>
      {open ? (
        <section
          id="notification-popover"
          className="notification-popover"
          aria-label="Recent notifications"
        >
          <div className="notification-popover-header">
            <h2>Notifications</h2>
            <button
              type="button"
              className="text-button"
              disabled={unreadCount === 0 || readAllMutation.isPending}
              onClick={() => readAllMutation.mutate()}
            >
              Mark all as read
            </button>
          </div>
          {listQuery.isPending ? (
            <p role="status">Loading notifications…</p>
          ) : listQuery.isError ? (
            <p role="alert">Notifications could not be loaded.</p>
          ) : listQuery.data.data.length === 0 ? (
            <p>No notifications yet.</p>
          ) : (
            <ul className="notification-list">
              {listQuery.data.data.map((notification) => (
                <li key={notification.id}>
                  <Link
                    to={`/games/${encodeURIComponent(notification.game.slug)}`}
                    onClick={() => {
                      if (notification.readAt === null) readMutation.mutate(notification.id);
                      setOpen(false);
                    }}
                  >
                    <span>{notification.message}</span>
                    <time dateTime={notification.createdAt}>
                      {new Date(notification.createdAt).toLocaleString()}
                    </time>
                    {notification.readAt === null ? <span className="sr-only">Unread</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link
            className="notification-all-link"
            to="/notifications"
            onClick={() => setOpen(false)}
          >
            View all notifications
          </Link>
        </section>
      ) : null}
    </div>
  );
}
