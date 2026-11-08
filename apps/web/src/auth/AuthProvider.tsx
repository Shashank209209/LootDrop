import { QueryClient, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthSessionResponse, AuthUser } from '@dealhunter/contracts';
import { logout, restoreSession, setAccessToken } from '../lib/api-client.js';

type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'anonymous'; user: null }
  | { status: 'authenticated'; user: AuthUser };

type AuthContextValue = {
  state: AuthState;
  acceptSession: (session: AuthSessionResponse) => void;
  logOut: () => Promise<void>;
  logoutError: string | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function clearUserQueries(queryClient: QueryClient): void {
  queryClient.clear();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null });
  const [logoutError, setLogoutError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void restoreSession().then((session) => {
      if (!active) return;
      setState(
        session
          ? { status: 'authenticated', user: session.user }
          : { status: 'anonymous', user: null },
      );
    });
    const handleExpired = () => {
      setAccessToken(null);
      clearUserQueries(queryClient);
      setState({ status: 'anonymous', user: null });
    };
    window.addEventListener('lootdrop:session-expired', handleExpired);
    return () => {
      active = false;
      window.removeEventListener('lootdrop:session-expired', handleExpired);
    };
  }, [queryClient]);

  const acceptSession = useCallback((session: AuthSessionResponse) => {
    setAccessToken(session.accessToken);
    setLogoutError(null);
    setState({ status: 'authenticated', user: session.user });
  }, []);

  const logOut = useCallback(async () => {
    setLogoutError(null);
    try {
      await logout();
    } catch {
      setLogoutError('The server could not confirm session revocation.');
      setAccessToken(null);
    } finally {
      clearUserQueries(queryClient);
      setState({ status: 'anonymous', user: null });
    }
  }, [queryClient]);

  const value = useMemo(
    () => ({ state, acceptSession, logOut, logoutError }),
    [state, acceptSession, logOut, logoutError],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
