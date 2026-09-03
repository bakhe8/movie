'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, ApiError, setAuthToken, type Profile, type User } from './api';

const STORAGE_KEY = 'reel.session.v1';

interface StoredSession {
  token: string;
  user: User;
}

interface SessionState {
  ready: boolean;
  token: string | null;
  user: User | null;
  profile: Profile | null;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; password: string; firstName: string; lastName: string }) => Promise<void>;
  logout: () => void;
  clearError: () => void;
}

const SessionContext = createContext<SessionState | null>(null);

// MVP: one profile per account, auto-created on first login. A profile
// picker/management UI is out of scope for this vertical slice.
const DEFAULT_PROFILE_NAME = 'ملف الذوق الرئيسي';

async function ensureProfile(): Promise<Profile> {
  const profiles = await api.getProfiles();
  if (profiles.length > 0) {
    return profiles[0];
  }
  return api.createProfile({ name: DEFAULT_PROFILE_NAME, preferredLanguage: 'ar' });
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  // token+user are set together (login/register/hydrate) or cleared
  // together (logout/invalid token) -- one state slice, one update.
  const [auth, setAuth] = useState<StoredSession | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hydrate from localStorage on mount. This has to be an effect, not a
  // lazy useState initializer: 'use client' components still render on the
  // server first, where `window` doesn't exist.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const stored: StoredSession = JSON.parse(raw);
        setAuthToken(stored.token);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setAuth(stored);
      }
    } catch {
      // Corrupt localStorage entry -- ignore and start signed out.
    } finally {
      setReady(true);
    }
  }, []);

  // Resolve (or create) the taste profile whenever the account changes;
  // state updates only happen inside the promise callbacks below, not
  // synchronously in the effect body.
  useEffect(() => {
    if (!auth) {
      return;
    }
    let cancelled = false;
    ensureProfile()
      .then((resolved) => {
        if (!cancelled) {
          setProfile(resolved);
        }
      })
      .catch(() => {
        if (!cancelled) {
          // Stored token no longer valid server-side; drop the session.
          window.localStorage.removeItem(STORAGE_KEY);
          setAuthToken(null);
          setAuth(null);
          setProfile(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [auth]);

  const applyAuth = useCallback(async (token: string, user: User) => {
    setAuthToken(token);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
    setAuth({ token, user });
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      setError(null);
      try {
        const result = await api.login({ email, password });
        await applyAuth(result.access_token, result.user);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'تعذر تسجيل الدخول');
        throw err;
      }
    },
    [applyAuth],
  );

  const register = useCallback(
    async (data: { email: string; password: string; firstName: string; lastName: string }) => {
      setError(null);
      try {
        const result = await api.register(data);
        await applyAuth(result.access_token, result.user);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'تعذر إنشاء الحساب');
        throw err;
      }
    },
    [applyAuth],
  );

  const logout = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setAuthToken(null);
    setAuth(null);
    setProfile(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return (
    <SessionContext.Provider
      value={{
        ready,
        token: auth?.token ?? null,
        user: auth?.user ?? null,
        profile,
        error,
        login,
        register,
        logout,
        clearError,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}
