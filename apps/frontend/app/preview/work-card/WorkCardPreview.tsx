'use client';

import { WorkCard } from '../../components/WorkCard';
import home from '../../components/RecommendationsScreen.module.css';
import type { Recommendation, Title } from '../../lib/api';
import type { PublicQuality } from '../../public-quality/types';
import styles from './preview.module.css';

// The states live in the client component because the card takes handlers:
// a server component cannot pass one across the boundary.
const title: Title = {
  id: 't1',
  internalId: 'i1',
  titleEn: 'Divine Intervention',
  titleAr: 'يد إلهية',
  description: null,
  releaseYear: 2002,
  genres: null,
  posterUrl: null,
};

type PreviewRecommendation = Recommendation & {
  publicQuality?: PublicQuality | null;
  watchability?: { available: boolean | null; providers: { name: string; market: string }[] } | null;
};

const base: PreviewRecommendation = {
  recommendationId: 'r1',
  title,
  personalFitScore: 0.9,
  publicQualityScore: 6.6,
  publicQuality: {
    value: 6.6,
    votes: 4239,
    sources: [{ source: 'imdb', value: 6.6, scale: '1-10', votes: 4239, capturedAt: '2026-09-05T00:00:00.000Z', attribution: null }],
  },
  watchabilityScore: null,
  watchability: { available: null, providers: [] },
  availability: 'unknown',
  confidenceBand: 'inconclusive',
  fingerprintCoverage: 1,
  track: 'safe',
  modelVersion: 'preview',
  reason: { features: [{ key: 'ambiguity', direction: 'higher' }], evidenceSource: 'individual' },
};

const withTitle = (rec: PreviewRecommendation, id: string, titleEn: string, titleAr: string, releaseYear: number): PreviewRecommendation => ({
  ...rec,
  recommendationId: `r-${id}`,
  title: { ...title, id, internalId: `i-${id}`, titleEn, titleAr, releaseYear },
});

const STATES: { name: string; rec: PreviewRecommendation; position: number; count: number }[] = [
  { name: 'high fit · quality known · availability unknown', rec: base, position: 1, count: 7 },
  {
    name: 'medium fit · likely confidence · available',
    rec: withTitle(
      { ...base, confidenceBand: 'likely', watchabilityScore: 1, watchability: { available: true, providers: [{ name: 'MUBI', market: 'SA' }] }, availability: 'available', track: 'discovery' },
      't2',
      'No Country for Old Men',
      'لا بلد للعجائز',
      2007,
    ),
    position: 4,
    count: 7,
  },
  {
    name: 'lower fit · no quality source · partial fingerprint',
    rec: withTitle(
      { ...base, publicQualityScore: null, publicQuality: null, watchability: null, fingerprintCoverage: 0.6, confidenceBand: 'initial', track: 'outside_usual' },
      't3',
      'Trainspotting',
      'ترينسبوتينغ',
      1996,
    ),
    position: 7,
    count: 7,
  },
  {
    name: 'high fit · another safe choice',
    rec: withTitle(base, 't4', 'Clash', 'اشتباك', 2016),
    position: 2,
    count: 7,
  },
  {
    name: 'medium fit · another discovery',
    rec: withTitle({ ...base, personalFitScore: 0.6, confidenceBand: 'likely', track: 'discovery' }, 't5', 'The Big Lebowski', 'ليباوسكي الكبير', 1998),
    position: 5,
    count: 7,
  },
];

export function WorkCardPreview({ lang }: { lang: 'ar' | 'en' }) {
  return (
    <>
      <section aria-label="shelf of tiles" className={styles.slot}>
        <p className={styles.name}>shelf (compact tiles, as the home screen shows a track)</p>
        <ol className={home.rail}>
          {STATES.map((state) => (
            <li key={`tile-${state.name}`}>
              <WorkCard
                lang={lang}
                position={state.position}
                count={state.count}
                compact
                recommendation={state.rec}
                listed={false}
                busy={false}
                onOpen={() => {}}
              />
            </li>
          ))}
        </ol>
      </section>

      {STATES.map((state) => (
        <section key={state.name} aria-label={state.name} className={styles.slot}>
          <p className={styles.name}>{state.name}</p>
          <WorkCard
            lang={lang}
            position={state.position}
            count={state.count}
            recommendation={state.rec}
            listed={false}
            busy={false}
            onOpen={() => {}}
          />
        </section>
      ))}
    </>
  );
}
