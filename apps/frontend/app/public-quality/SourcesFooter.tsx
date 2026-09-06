import { DataNoticeBadge } from '../data-notice/DataNoticeBadge';
import type { Lang } from '../legal/content';
import styles from './SourcesFooter.module.css';
import { SOURCE_LABEL, type PublicQuality, type TextSource } from './types';

/**
 * The one place on a page where third-party attribution lives (owner,
 * 2026-09-04): a single "Sources: IMDb · TMDB · Wikipedia" line with the
 * rights badge, and the verbatim lines each source requires folded under it
 * so they are on the same page without shaping it. Nothing else on the page
 * renders an attribution sentence or a badge.
 *
 * Built to be removed: when the agreements of the revenue-model study land,
 * this component is unmounted -- one line in the host -- and no cell, card
 * or header needs redesign. Keep it that way: add sources here, never
 * inline elsewhere.
 */
export interface PageSource {
  name: string;
  attribution: string | null;
  url: string | null;
}

// What a work page knows about its sources; every field optional so the
// footer works for any surface that has some of them.
export interface PageSourcesInput {
  publicQuality?: PublicQuality | null;
  posterSource?: { name: string; attribution: string } | null;
  // The rest of the poster set (P5): each image credits its own source.
  posters?: { posterSource: { name: string; attribution: string } | null }[] | null;
  descriptionSource?: TextSource | null;
}

// Dedupes by name, keeps the first attribution/url seen for a name.
export function collectSources(input: PageSourcesInput): PageSource[] {
  const found = new Map<string, PageSource>();
  const add = (name: string, attribution: string | null, url: string | null) => {
    const existing = found.get(name);
    if (!existing) {
      found.set(name, { name, attribution, url });
    } else {
      existing.attribution ??= attribution;
      existing.url ??= url;
    }
  };
  for (const s of input.publicQuality?.sources ?? []) {
    add(SOURCE_LABEL[s.source] ?? s.source, s.attribution, null);
  }
  if (input.posterSource) {
    add(input.posterSource.name, input.posterSource.attribution, null);
  }
  for (const poster of input.posters ?? []) {
    if (poster.posterSource) {
      add(poster.posterSource.name, poster.posterSource.attribution, null);
    }
  }
  if (input.descriptionSource) {
    add(input.descriptionSource.name, input.descriptionSource.attribution, input.descriptionSource.url);
  }
  return [...found.values()];
}

const copy = {
  ar: { label: 'المصادر', details: 'حقوق المصادر ونصوصها', open: (name: string) => `الصفحة في ${name}` },
  en: { label: 'Sources', details: 'Attribution', open: (name: string) => `Page on ${name}` },
};

export function SourcesFooter({ lang, sources, className }: { lang: Lang; sources: PageSource[]; className?: string }) {
  if (sources.length === 0) {
    return null;
  }
  const t = copy[lang];
  const withText = sources.filter((s) => s.attribution || s.url);
  return (
    <footer className={[styles.footer, className].filter(Boolean).join(' ')}>
      <div className={styles.line}>
        <span className={styles.label}>{t.label}:</span>
        <span className={styles.names}>{sources.map((s) => s.name).join(' · ')}</span>
        <DataNoticeBadge lang={lang} />
      </div>
      {withText.length > 0 && (
        <details className={styles.details}>
          <summary className={styles.summary}>{t.details}</summary>
          <ul className={styles.list}>
            {withText.map((s) => (
              <li key={s.name} className={styles.item}>
                {/* Each source's own wording and direction, untouched. */}
                {s.attribution && (
                  <span lang="en" dir="ltr">
                    {s.attribution}
                  </span>
                )}
                {s.url && (
                  <a className={styles.link} href={s.url} target="_blank" rel="noopener noreferrer license">
                    {t.open(s.name)}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </footer>
  );
}
