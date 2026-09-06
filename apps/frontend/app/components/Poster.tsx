'use client';

import { useRef, useState } from 'react';
import type { Title } from '../lib/api';
import { usePosterRotation } from './PosterSet';
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
 *
 * POSTERS-MULTI P5 (ADR-120, direction د): with more than one poster the slot
 * becomes a stack of layers of the same size, the shown one fading in over
 * the last (240ms; instant under reduced motion). Which one is shown is
 * usePosterRotation's call -- rotation on touch, hover on a fine pointer,
 * nothing at all under reduced motion -- unless the caller passes
 * `posterIndex` to keep several surfaces in step (the work page's cover).
 * Only the shown image and the next are in the tree, so a page never fetches
 * a poster it is not about to show.
 */
type Size = 'sm' | 'md' | 'lg';

export function Poster({
  title,
  size = 'sm',
  className,
  name,
  posterIndex,
  posterActive,
  still = false,
}: {
  title?: Pick<Title, 'posterUrl' | 'posters'> | null;
  size?: Size;
  className?: string;
  // Shown as its first letter when there is no licensed image, so two films
  // without posters do not read as the same empty frame
  // (UX_AUDIT_MOBILE_2026-09-05 P1 #13).
  name?: string | null;
  // The caller's own rotation (work page cover + poster in step), and
  // whether it is running at all -- when it is not, only the first image is
  // fetched, exactly as under the slot's own reduced-motion rule.
  posterIndex?: number;
  posterActive?: boolean;
  // A surface where the image must never change on its own or under the
  // pointer -- the triad, a decision made by comparing three films
  // (coordinator decision, 2026-09-06): the first poster, and only it.
  still?: boolean;
}) {
  const classes = [styles.poster, styles[size], className].filter(Boolean).join(' ');
  const url = title?.posterUrl ?? null;
  const posters = title?.posters ?? [];
  const stackRef = useRef<HTMLSpanElement>(null);
  const own = usePosterRotation(posterIndex === undefined && url && !still ? posters.length : 0, stackRef);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (url && posters.length > 1 && !still && failedUrl !== url) {
    const index = posterIndex === undefined ? own.index : posterIndex;
    // The shown image and the one after it; the rest wait until their turn.
    // While nothing rotates (reduced motion, or a fine pointer not hovering)
    // the first image is the only one fetched.
    const active = posterIndex === undefined ? own.active : posterActive !== false;
    const shown = active ? Math.min(posters.length, index + 2) : 1;
    return (
      <span ref={stackRef} className={`${classes} ${styles.stack}`} data-poster-count={posters.length} data-poster-stack="">
        {posters.slice(0, shown).map((poster, layer) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={poster.posterUrl}
            className={styles.layer}
            src={poster.posterUrl}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={layer === 0 ? () => setFailedUrl(url) : undefined}
            data-poster-layer=""
            data-active={layer === index || undefined}
          />
        ))}
      </span>
    );
  }
  if (url && failedUrl !== url) {
    // The browser fetches this from the image host itself (TMDB today), so
    // that host sees the request. `no-referrer` keeps it from also learning
    // which page of ours the viewer was on -- the page path is the part that
    // says something about the person (P1-1). The response header set in
    // next.config.ts covers the CSS backdrop the work page paints from the
    // same URL; this attribute keeps the guarantee on the element itself,
    // wherever the markup is served from.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={classes}
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(url)}
        data-poster-count={posters.length}
      />
    );
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
