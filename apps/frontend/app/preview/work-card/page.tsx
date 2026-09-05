import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { resolveLang } from '../../legal/LegalPage';
import styles from './preview.module.css';
import { WorkCardPreview } from './WorkCardPreview';

export const metadata: Metadata = { title: 'Kolme — work card preview' };

// Development-only preview of the work card's states at phone width, the same
// way app/public-quality/preview does for the quality cell: it needs no
// session and no API, so a card change can be reviewed and captured at 375px
// before it reaches a signed-in screen (UX-B, ADR-111). 404 in production --
// it is not a product surface.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }
  const lang = resolveLang((await searchParams).lang);
  return (
    <main className={styles.page} lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <h1 className={styles.h1}>WorkCard — {lang}</h1>
      <WorkCardPreview lang={lang} />
    </main>
  );
}
