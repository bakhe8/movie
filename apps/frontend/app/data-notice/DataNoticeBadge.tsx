import Link from 'next/link';
import type { Lang } from '../legal/content';
import styles from './DataNoticeBadge.module.css';

/**
 * The rights badge (owner decision 2026-09-04): a small link that sits next
 * to every attribution line and every external score, and opens the
 * development notice (/data-notice). One component so the wording and the
 * target are the same everywhere; the host surface decides placement.
 * Server-safe: no state, no hooks.
 */
const copy = {
  ar: { label: 'بيانات قيد التطوير · المصادر والحقوق', title: 'إشعار مرحلة التطوير واستخدام البيانات الخارجية' },
  en: { label: 'Data under development · sources and rights', title: 'Development notice and third-party data statement' },
};

export function DataNoticeBadge({ lang, className }: { lang: Lang; className?: string }) {
  const c = copy[lang];
  return (
    <Link href={`/data-notice?lang=${lang}`} className={[styles.badge, className].filter(Boolean).join(' ')} title={c.title}>
      <span className={styles.dot} aria-hidden="true" />
      {c.label}
    </Link>
  );
}
