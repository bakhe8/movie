import { DataNoticeBadge } from '../data-notice/DataNoticeBadge';
import type { Lang } from '../legal/content';
import { formatDate, formatNumber } from '../lib/format';
import styles from './PublicQualityCell.module.css';
import { SOURCE_LABEL, type PublicQuality } from './types';

/**
 * The Public Quality cell (BP §5.3, §10.3; ALPHA_PLAN 5.3): one value per
 * source with its scale, vote count and date, the source's required
 * attribution line verbatim beneath it, and the rights badge that opens
 * /data-notice. Never merged into one number: two sources are two rows.
 * `null` renders the hollow "no source yet" chip -- never 0 (BP §11.3).
 *
 * Standalone by design (owner, 2026-09-04): imports nothing from session B's
 * components, so it drops into WorkScreen / WorkCard as one element; the
 * `cells` layout it sits in belongs to the host.
 */
const copy = {
  ar: {
    label: 'الجودة العامة',
    unknown: 'لا مصدر بعد',
    outOf: (scale: string) => `من ${scale.split('-')[1] ?? scale}`,
    votes: (n: string) => `${n} تصويت`,
    asOf: (d: string) => `بتاريخ ${d}`,
    sources: 'مصادر منفصلة، لا تُدمج',
  },
  en: {
    label: 'Public quality',
    unknown: 'No source yet',
    outOf: (scale: string) => `out of ${scale.split('-')[1] ?? scale}`,
    votes: (n: string) => `${n} votes`,
    asOf: (d: string) => `as of ${d}`,
    sources: 'Separate sources, never merged',
  },
};

export function PublicQualityCell({ quality, lang, headless = false }: { quality: PublicQuality | null | undefined; lang: Lang; headless?: boolean }) {
  const t = copy[lang];
  const sources = quality?.sources.filter((s) => s.value !== null) ?? [];

  return (
    <div className={styles.cell}>
      {!headless && <dt className={styles.label}>{t.label}</dt>}
      <dd className={styles.body}>
        {sources.length === 0 ? (
          <span className={styles.hollow}>{t.unknown}</span>
        ) : (
          <>
            {sources.length > 1 && <span className={styles.note}>{t.sources}</span>}
            {sources.map((s) => (
              <div key={s.source} className={styles.source}>
                <div className={styles.line}>
                  <span className={styles.num}>{formatNumber(s.value as number, lang)}</span>
                  {s.scale && <span className={styles.sub}>{t.outOf(s.scale)}</span>}
                  <span className={styles.sub}>
                    {[SOURCE_LABEL[s.source] ?? s.source, s.votes !== null ? t.votes(formatNumber(s.votes, lang)) : null, t.asOf(formatDate(s.capturedAt, lang))]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
                {s.attribution && (
                  // The source's own wording and direction, untouched.
                  <p className={styles.attribution} lang="en" dir="ltr">
                    {s.attribution}
                  </p>
                )}
              </div>
            ))}
            <DataNoticeBadge lang={lang} className={styles.badge} />
          </>
        )}
      </dd>
    </div>
  );
}
