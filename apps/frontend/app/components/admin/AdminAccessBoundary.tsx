'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useSession } from '../../lib/session';
import s from '../AdminScreen.module.css';

// ADMIN-W1 (ADR-117, AUDIT_2026-09-05 C1/M5 follow-up): the access boundary
// every admin destination mounts behind. Replaces AdminScreen's old
// `adminGetTitles({limit:1})` probe, which collapsed every failure --
// anonymous, non-admin, offline, slow, or a real server error -- into one
// "no access" message. `checking` never resolves before session hydration
// (ADM-P1-01): a direct reload must not fire the probe with a token that
// has not been read from storage yet.
export type AdminAccessState =
  | { status: 'checking' }
  | { status: 'unauthenticated' }
  | { status: 'forbidden' }
  | { status: 'timeout' }
  | { status: 'network_error' }
  | { status: 'server_error' }
  | { status: 'allowed'; capabilities: string[] };

const CONTEXT_TIMEOUT_MS = 8000;

const AdminCapabilitiesContext = createContext<string[]>([]);

// UI hint only (ADR-117): callers use this to show/hide sections, never to
// decide whether a request is allowed -- the server enforces that.
export function useAdminCapabilities(): string[] {
  return useContext(AdminCapabilitiesContext);
}

const MESSAGE: Record<Exclude<AdminAccessState['status'], 'allowed'>, string> = {
  checking: 'جارٍ التحقق من الصلاحية...',
  unauthenticated: 'سجّل الدخول لعرض لوحة الإدارة.',
  forbidden: 'ليس لديك صلاحية الوصول إلى لوحة الإدارة.',
  timeout: 'استغرق التحقق من الصلاحية وقتاً طويلاً.',
  network_error: 'تعذّر الاتصال بالخادم للتحقق من الصلاحية.',
  server_error: 'خطأ في الخادم أثناء التحقق من الصلاحية.',
};

const RETRYABLE: ReadonlySet<AdminAccessState['status']> = new Set(['timeout', 'network_error', 'server_error']);

export function AdminAccessBoundary({ children }: { children: React.ReactNode }) {
  const { ready, token } = useSession();
  const [state, setState] = useState<AdminAccessState>({ status: 'checking' });
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  useEffect(() => {
    // Session not hydrated yet: stay on `checking` rather than probing with
    // a token that may still be in localStorage, unread (ADM-P1-01).
    if (!ready) return;

    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONTEXT_TIMEOUT_MS);

    void (async () => {
      await Promise.resolve(); // defer setState out of synchronous effect context
      if (cancelled) return;
      if (!token) {
        setState({ status: 'unauthenticated' });
        return;
      }
      setState({ status: 'checking' });
      try {
        const context = await api.adminGetContext(controller.signal);
        if (cancelled) return;
        setState({ status: 'allowed', capabilities: context.capabilities });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError) {
          if (err.status === 401) setState({ status: 'unauthenticated' });
          else if (err.status === 403) setState({ status: 'forbidden' });
          else if (err.status >= 500) setState({ status: 'server_error' });
          else setState({ status: 'network_error' });
        } else if (err instanceof DOMException && err.name === 'AbortError') {
          setState({ status: 'timeout' });
        } else {
          setState({ status: 'network_error' });
        }
      } finally {
        clearTimeout(timeoutId);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [ready, token, attempt]);

  if (state.status === 'allowed') {
    return <AdminCapabilitiesContext.Provider value={state.capabilities}>{children}</AdminCapabilitiesContext.Provider>;
  }

  return (
    <div className={s.screen}>
      <p className={s.forbidden} role="status" aria-live="polite">
        {MESSAGE[state.status]}
      </p>
      {RETRYABLE.has(state.status) && (
        <button type="button" className={s.pageBtn} onClick={retry}>
          إعادة المحاولة
        </button>
      )}
    </div>
  );
}
