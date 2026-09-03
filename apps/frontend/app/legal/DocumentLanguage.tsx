'use client';

import { useEffect } from 'react';
import type { Lang } from './content';

/**
 * Keeps the document's `lang`/`dir` in step with the page's language, the
 * way app/page.tsx does for the app: the root layout is Arabic/RTL by
 * default, and an LTR page inside an RTL root leaves a few pixels of
 * horizontal scroll (measured: 378px of scroll width on a 375px viewport).
 * The app page re-sets both on its own mount, so nothing is restored here.
 */
export function DocumentLanguage({ lang }: { lang: Lang }) {
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);
  return null;
}
