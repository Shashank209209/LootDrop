import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import { useWishlist } from '../hooks/useWishlist.js';

export function WishlistButton({ gameId, gameTitle }: { gameId: string; gameTitle: string }) {
  const { state } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const wishlist = useWishlist();
  const isWishlisted = wishlist.gameIds.includes(gameId);

  const handleClick = () => {
    if (state.status !== 'authenticated') {
      navigate('/login', {
        state: { returnTo: `${location.pathname}${location.search}${location.hash}` },
      });
      return;
    }
    wishlist.toggle(gameId, !isWishlisted);
  };

  return (
    <span className="wishlist-control">
      <button
        type="button"
        className={`wishlist-button${isWishlisted ? ' active' : ''}`}
        aria-label={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
        aria-pressed={isWishlisted}
        disabled={wishlist.isPending(gameId)}
        onClick={handleClick}
      >
        {isWishlisted ? '♥' : '♡'}
        <span className="visually-hidden"> {gameTitle}</span>
      </button>
      {wishlist.error ? (
        <span role="alert" className="wishlist-error">
          Wishlist update failed. Try again.
        </span>
      ) : null}
    </span>
  );
}
