import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import type { GameDetailResponse } from '@dealhunter/contracts';
import { AlertDialog } from './AlertDialog.js';

type GameListing = GameDetailResponse['data']['listings'][number];

export function SetAlertButton({
  gameId,
  gameSlug,
  gameTitle,
  listings,
  compact = false,
}: {
  gameId: string;
  gameSlug: string;
  gameTitle: string;
  listings?: readonly GameListing[];
  compact?: boolean;
}) {
  const { state } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const activate = () => {
    if (state.status !== 'authenticated') {
      navigate('/login', {
        state: { returnTo: `${location.pathname}${location.search}${location.hash}` },
      });
      return;
    }
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        className={compact ? 'ghost-button alert-bell-button' : 'primary-button'}
        aria-label={compact ? `Set price alert for ${gameTitle}` : undefined}
        onClick={activate}
      >
        {compact ? <span aria-hidden="true">♧</span> : 'Set alert'}
      </button>
      {open ? (
        <AlertDialog
          gameId={gameId}
          gameSlug={gameSlug}
          gameTitle={gameTitle}
          {...(listings === undefined ? {} : { listings })}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
