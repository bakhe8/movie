import type { Lang } from '../legal/content';
import { formatDate, formatNumber } from '../lib/format';
import { RatingStar } from '../components/RatingStar';
import styles from './PublicQualityCell.module.css';
import { SOURCE_LABEL, type PublicQuality } from './types';

/**
 * The Public Quality cell (BP §5.3, §10.3; ALPHA_PLAN 5.3): one value per
 * source with its scale, source name and vote count. Never merged into one
 * number: two sources are two rows. `null` renders the hollow "no source
 * yet" chip -- never 0 (BP §11.3).
 *
 * No attribution sentence and no badge here (owner, 2026-09-04): those live
 * once per page in <SourcesFooter>, so they can be removed in one place when
 * the agreements land, without redesigning the cell.
 *
 * Standalone by design: imports nothing from session B's components, so it
 * drops into WorkScreen / WorkCard as one element; the `cells` layout it
 * sits in belongs to the host.
 */
const copy = {
  ar: {
    label: 'الجودة العامة',
    unknown: 'لا مصدر بعد',
    votes: (n: string) => `${n} تصويت`,
    capturedAt: (d: string) => `بتاريخ ${d}`,
    sources: 'مصادر منفصلة، لا تُدمج',
  },
  en: {
    label: 'Public quality',
    unknown: 'No source yet',
    votes: (n: string) => `${n} votes`,
    capturedAt: (d: string) => `as of ${d}`,
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
                  {/* Star + number: the scale is the star's to say (owner's
                      addendum 3). The source and the day it was read stay in
                      words -- they are facts, not decoration. */}
                  <span className={styles.rating}>
                    {/* A source with a mark of its own wears it instead of its
                        name (owner's addenda 3 and 4, and their explicit
                        instruction to use the official artwork). The file is
                        IMDb's own, unedited, with its clear space -- which is
                        why the box is taller than the ink; provenance in
                        public/brand/NOTICE. A source with no mark keeps the
                        neutral star. */}
                    {s.source === 'imdb' ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img className={styles.mark} src="/brand/imdb.svg" alt="IMDb" width={58} height={32} />
                    ) : (
                      <RatingStar size={15} />
                    )}
                    <span className={styles.num}>{formatNumber(s.value as number, lang)}</span>
                  </span>
                  <span className={styles.sub}>
                    {[
                      // Only for a source the mark cannot speak for.
                      s.source === 'imdb' ? null : (SOURCE_LABEL[s.source] ?? s.source),
                      s.votes !== null ? t.votes(formatNumber(s.votes, lang)) : null,
                      // A public score is a reading taken on a day, not a
                      // standing fact: the day it was captured is shown with
                      // it (remediation brief P1-05 / L10N-01). Absent only
                      // for a source that predates the column.
                      s.capturedAt ? t.capturedAt(formatDate(s.capturedAt, lang)) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
              </div>
            ))}
          </>
        )}
      </dd>
    </div>
  );
}
