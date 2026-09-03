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

export function Poster({ title, size = 'sm', className }: { title?: Pick<Title, 'posterUrl'> | null; size?: Size; className?: string }) {
  const classes = [styles.poster, styles[size], className].filter(Boolean).join(' ');
  const url = title?.posterUrl ?? null;
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={classes} src={url} alt="" loading="lazy" decoding="async" />;
  }
  return <span className={`${classes} ${styles.hollow}`} aria-hidden="true" />;
}
