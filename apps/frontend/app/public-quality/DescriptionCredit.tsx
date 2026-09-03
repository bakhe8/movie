import { DataNoticeBadge } from '../data-notice/DataNoticeBadge';
import type { Lang } from '../legal/content';
import styles from './DescriptionCredit.module.css';
import type { TextSource } from './types';

/**
 * The credit line under a description (ALPHA_PLAN 5.1 follow-up): the
 * source's required attribution verbatim, a link to the page when the
 * license asks for one (CC BY-SA), and the rights badge. Reads
 * `descriptionSource` as GET /titles/:id returns it from the rights
 * registry; renders nothing when it is null -- the client never invents a
 * credit (DATA_LICENSING.md §5). Standalone like PublicQualityCell: drops
 * under WorkScreen's description as one element.
 */
const copy = {
  ar: { open: (name: string) => `الصفحة في ${name}` },
  en: { open: (name: string) => `Page on ${name}` },
};

export function DescriptionCredit({ source, lang, className }: { source: TextSource | null | undefined; lang: Lang; className?: string }) {
  if (!source || (!source.attribution && !source.url)) {
    return null;
  }
  const t = copy[lang];
  return (
    <div className={[styles.credit, className].filter(Boolean).join(' ')}>
      {/* The source's own wording and direction, untouched. */}
      {source.attribution && (
        <span className={styles.line} lang="en" dir="ltr">
          {source.attribution}
        </span>
      )}
      {source.url && (
        <a className={styles.link} href={source.url} target="_blank" rel="noopener noreferrer license">
          {t.open(source.name)}
        </a>
      )}
      <DataNoticeBadge lang={lang} />
    </div>
  );
}
