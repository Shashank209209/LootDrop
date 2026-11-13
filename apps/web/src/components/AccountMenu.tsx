import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import { NotificationBell } from './NotificationBell.js';

export function AccountMenu() {
  const { state, logOut, logoutError } = useAuth();
  if (state.status !== 'authenticated') {
    return (
      <nav className="account-menu" aria-label="Account">
        <Link className="ghost-button" to="/login">
          Log in
        </Link>
        <Link className="primary-button" to="/register">
          Register
        </Link>
      </nav>
    );
  }

  return (
    <div className="account-menu">
      <span className="account-name">{state.user.displayName}</span>
      <Link className="ghost-button" to="/wishlist">
        Wishlist
      </Link>
      <Link className="ghost-button" to="/alerts">
        Alerts
      </Link>
      <NotificationBell />
      <button type="button" className="ghost-button" onClick={() => void logOut()}>
        Log out
      </button>
      {logoutError ? (
        <span role="alert" className="wishlist-error">
          {logoutError}
        </span>
      ) : null}
    </div>
  );
}
