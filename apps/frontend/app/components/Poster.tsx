'use client';

import type { Title } from '../lib/api';
import styles from './Poster.module.css';

/**
 * The poster slot (owner decision 2026-09-04: a poster is essential on every
 * surface that names a film). The slot is always present so layouts do not
 * shift when a poster arrives; without a licensed image it is hollow -- never
 * a stock image, never a generated one (DATA_LICENSING §4 rule 5, decision
 * Q16: unknown is hollow, never zero).
 *
 * The URL comes from the API only when the rights registry allows display
 * (SCHEMA.md §5); the frontend never composes image URLs itself. A plain
 * <img>: poster hosts are decided by the registry, not next.config.
 */
type Size = 'sm' | 'md' | 'lg';

export function Poster({
  title,
  size = 'sm',
  className,
  name,
}: {
  title?: Pick<Title, 'posterUrl'> | null;
  size?: Size;
  className?: string;
  // Shown as its first letter when there is no licensed image, so two films
  // without posters do not read as the same empty frame
  // (UX_AUDIT_MOBILE_2026-09-05 P1 #13).
  name?: string | null;
}) {
  const classes = [styles.poster, styles[size], className].filter(Boolean).join(' ');
  const url = title?.posterUrl ?? null;
  if (url) {
    // The browser fetches this from the image host itself (TMDB today), so
    // that host sees the request. `no-referrer` keeps it from also learning
    // which page of ours the viewer was on -- the page path is the part that
    // says something about the person (P1-1). The response header set in
    // next.config.ts covers the CSS backdrop the work page paints from the
    // same URL; this attribute keeps the guarantee on the element itself,
    // wherever the markup is served from.
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={classes} src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />;
  }
  // The empty slot is drawn, not left blank (remediation brief P1-05 /
  // L10N-01): a dashed 2:3 frame with a neutral film mark, so a title with no
  // licensed image reads as "no poster" rather than as a broken layout. The
  // mark is a glyph in `currentColor` -- not an image, not a stock still, not
  // a generated one (DATA_LICENSING §4 rule 5, decision Q16).
  const initial = name?.trim()?.[0] ?? null;
  return (
    <span className={`${classes} ${styles.hollow}`} aria-hidden="true">
      {initial ? (
        <span className={styles.initial}>{initial}</span>
      ) : (
        <svg className={styles.mark} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" focusable="false">
          <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
          <path d="M8.5 3.5v17M15.5 3.5v17" />
          <path d="M3.5 9h5M3.5 15h5M15.5 9h5M15.5 15h5" />
        </svg>
      )}
    </span>
  );
}
