import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WishlistIdsResponse } from '@dealhunter/contracts';
import { useAuth } from '../auth/AuthProvider.js';
import { addWishlistGame, getWishlistIds, removeWishlistGame } from '../lib/api-client.js';

export const wishlistIdsQueryKey = ['wishlist', 'ids'] as const;

export function useWishlist() {
  const { state } = useAuth();
  const queryClient = useQueryClient();
  const idsQuery = useQuery({
    queryKey: wishlistIdsQueryKey,
    queryFn: ({ signal }) => getWishlistIds(signal),
    enabled: state.status === 'authenticated',
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: async ({ gameId, add }: { gameId: string; add: boolean }) => {
      if (add) await addWishlistGame(gameId);
      else await removeWishlistGame(gameId);
    },
    onMutate: async ({ gameId, add }) => {
      await queryClient.cancelQueries({ queryKey: wishlistIdsQueryKey });
      const previous = queryClient.getQueryData<WishlistIdsResponse>(wishlistIdsQueryKey);
      if (previous) {
        const gameIds = new Set(previous.gameIds);
        if (add) gameIds.add(gameId);
        else gameIds.delete(gameId);
        queryClient.setQueryData(wishlistIdsQueryKey, { gameIds: [...gameIds] });
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(wishlistIdsQueryKey, context.previous);
      }
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: wishlistIdsQueryKey }),
        queryClient.invalidateQueries({ queryKey: ['wishlist', 'page'] }),
      ]);
    },
  });

  return {
    gameIds: idsQuery.data?.gameIds ?? [],
    isLoading: idsQuery.isPending && state.status === 'authenticated',
    error: mutation.error,
    toggle: (gameId: string, add: boolean) => mutation.mutate({ gameId, add }),
    isPending: (gameId: string) => mutation.isPending && mutation.variables?.gameId === gameId,
  };
}
