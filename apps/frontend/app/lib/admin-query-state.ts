'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

// ADMIN-W2: filters and the current page live in the URL so a reload, a
// copied link, or the browser's own back/forward restores the exact view
// (plan §18 W2, W0 preservation cases C1/C3/F1/F2/P1/P3). `replace`, not
// `push`: a filter edit updates the address bar without spamming history --
// only navigating between destinations (AdminShell's <Link>s) creates an
// entry a user would want "back" to return to.
//
// Not memoized: callers pass a fresh `keys` array literal every render
// (e.g. `useAdminQueryState(['query', 'page'] as const)`), so a dependency
// array built from it would recompute on every render regardless -- reading
// a handful of query-string entries is cheap enough that useMemo would only
// add overhead, not save any.
export function useAdminQueryState<Keys extends string>(keys: readonly Keys[]) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();

  const state = {} as Record<Keys, string>;
  for (const key of keys) state[key] = searchParams.get(key) ?? '';

  const setState = useCallback(
    (patch: Partial<Record<Keys, string>>) => {
      const next = new URLSearchParams(searchParamsString);
      for (const [key, value] of Object.entries(patch)) {
        if (!value) next.delete(key);
        else next.set(key, value as string);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParamsString],
  );

  return [state, setState] as const;
}
