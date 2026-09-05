import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { resolveLang } from '../../legal/LegalPage';
import { PublicQualityCell } from '../PublicQualityCell';
import { SourcesFooter, collectSources } from '../SourcesFooter';
import type { PublicQuality } from '../types';
import styles from './preview.module.css';

export const metadata: Metadata = { title: 'Kolme — Public Quality cell preview' };

// Development-only preview of the Public Quality cell's states, for review
// before session B mounts it in WorkScreen / WorkCard (board G3). 404 in
// production: it is not a product surface.
const imdb = {
  source: 'imdb',
  scale: '0-10',
  capturedAt: '2026-09-03T23:07:55.069Z',
  attribution: 'Information courtesy of IMDb (https://www.imdb.com). Used with permission.',
};

const STATES: { name: string; quality: PublicQuality | null }[] = [
  { name: 'one source', quality: { value: 9.3, votes: 3232959, sources: [{ ...imdb, value: 9.3, votes: 3232959 }] } },
  { name: 'few votes', quality: { value: 7.4, votes: 27, sources: [{ ...imdb, value: 7.4, votes: 27 }] } },
  {
    name: 'two sources (never merged)',
    quality: {
      value: null,
      votes: null,
      sources: [
        { ...imdb, value: 8.1, votes: 1500 },
        { source: 'other', value: 74, scale: '0-100', votes: 12, capturedAt: '2026-09-01T00:00:00Z', attribution: null },
      ],
    },
  },
  { name: 'no source (null, never 0)', quality: null },
];

// A work page's worth of sources, as WorkScreen would collect them.
const PAGE = collectSources({
  publicQuality: STATES[0].quality,
  posterSource: { name: 'TMDB', attribution: 'This product uses the TMDB API but is not endorsed or certified by TMDB.' },
  descriptionSource: { name: 'Wikipedia', attribution: 'Text from Wikipedia, licensed CC BY-SA 4.0', url: 'https://en.wikipedia.org/wiki/Cairo_Station' },
});

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }
  const lang = resolveLang((await searchParams).lang);
  return (
    <main className={styles.page} lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <h1 className={styles.h1}>PublicQualityCell — {lang}</h1>
      {STATES.map((state) => (
        <section key={state.name} className={styles.card} aria-label={state.name}>
          <p className={styles.name}>{state.name}</p>
          <dl className={styles.cells}>
            <PublicQualityCell quality={state.quality} lang={lang} />
          </dl>
        </section>
      ))}
      <h1 className={styles.h1}>SourcesFooter — {lang}</h1>
      <section className={styles.card} aria-label="sources footer">
        <p dir="auto">Cairo Station is a 1958 Egyptian crime-drama film directed by Youssef Chahine.</p>
        <SourcesFooter lang={lang} sources={PAGE} />
      </section>
      <section className={styles.card} aria-label="sources footer, nothing known">
        <p className={styles.name}>no sources (renders nothing)</p>
        <SourcesFooter lang={lang} sources={collectSources({})} />
      </section>
    </main>
  );
}
