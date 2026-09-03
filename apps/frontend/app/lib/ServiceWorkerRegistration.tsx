'use client';

import { useEffect } from 'react';

// Production only, on purpose: a service worker caching /_next/static/* and
// the navigation response would fight Turbopack's dev-mode hot reload,
// serving stale assets back to whoever is running `next dev` against this
// codebase (BP §5.1-§5.2, ADR-5).
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) {
      return;
    }
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Installability is a progressive enhancement; a failed registration
      // (unsupported browser, blocked storage) must not break the app.
    });
  }, []);

  return null;
}
