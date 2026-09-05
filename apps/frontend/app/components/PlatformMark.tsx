'use client';

import { useState } from 'react';
import styles from './PlatformMark.module.css';

const ASSETS = new Set(['netflix', 'shahid', 'osn', 'prime_video', 'apple_tv', 'disney_plus', 'youtube']);

/** First-party site marks identify a selected service, never availability. */
export function PlatformMark({ id, name }: { id: string; name?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={styles.mark} data-platform={id} aria-hidden="true">
      {ASSETS.has(id) && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/brand/platforms/${id}.ico`} alt="" width="32" height="32" onError={() => setFailed(true)} />
      ) : id === 'cinema' ? (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M7 5v14M17 5v14M3 10h4m-4 4h4m10-4h4m-4 4h4" /></svg>
      ) : <b>{(name || id).slice(0, 2).toUpperCase()}</b>}
    </span>
  );
}
