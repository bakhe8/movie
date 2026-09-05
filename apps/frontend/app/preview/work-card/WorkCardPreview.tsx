'use client';

import { WorkCard } from '../../components/WorkCard';
import type { Recommendation, Title } from '../../lib/api';
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

const base: Recommendation = {
  recommendationId: 'r1',
  title,
  personalFitScore: 0.9,
  publicQualityScore: 6.6,
  watchabilityScore: null,
  availability: 'unknown',
  confidenceBand: 'inconclusive',
  fingerprintCoverage: 1,
  track: 'safe',
  modelVersion: 'preview',
  reason: { features: [{ key: 'ambiguity', direction: 'higher' }], evidenceSource: 'individual' },
};

const STATES: { name: string; rec: Recommendation; position: number; count: number }[] = [
  { name: 'high fit · quality known · availability unknown', rec: base, position: 1, count: 7 },
  {
    name: 'medium fit · likely confidence · available',
    rec: { ...base, confidenceBand: 'likely', watchabilityScore: 1, availability: 'available', track: 'discovery' },
    position: 4,
    count: 7,
  },
  {
    name: 'lower fit · no quality source · partial fingerprint',
    rec: { ...base, publicQualityScore: null, fingerprintCoverage: 0.6, confidenceBand: 'initial', track: 'outside_usual' },
    position: 7,
    count: 7,
  },
];

export function WorkCardPreview({ lang }: { lang: 'ar' | 'en' }) {
  return (
    <>
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
