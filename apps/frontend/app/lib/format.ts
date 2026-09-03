// The only path from a model value to the screen (ADR-33 §5). Every surface
// that shows a prediction -- recommendations, taste profile, work page,
// library ranking -- formats through these helpers, so a raw score or a
// percentage cannot reach the user by accident.
import type { ConfidenceBand, RecommendationReason } from './api';
import { CONFIDENCE_BAND_COPY, FEATURE_REASON_COPY, SPOILER_DIMENSIONS } from './copy';

type Lang = 'ar' | 'en';

export type PersonalFitLevel = 'high' | 'medium' | 'low';

export interface PersonalFitDisplay {
  level: PersonalFitLevel;
  // 1-based position inside the item's own track, and the track's size.
  position: number;
  count: number;
}

// Confidence is one of the four blueprint §9.3 bands, rendered as its copy.
export function formatConfidence(band: ConfidenceBand, lang: Lang): { label: string; copy: string } {
  return CONFIDENCE_BAND_COPY[lang][band];
}

// Personal Fit is an ordinal score (θᵀφ + δ): it orders candidates, it is not a
// probability of liking, so it is never shown as a number or a percentage
// (blueprint §7.2, ADR-33 §3). The screen gets the item's position inside its
// track and a tertile level derived from that position -- relative forms only.
export function formatPersonalFit(position: number, count: number): PersonalFitDisplay {
  const third = Math.max(1, Math.ceil(count / 3));
  const level: PersonalFitLevel = position <= third ? 'high' : position <= 2 * third ? 'medium' : 'low';
  return { level, position, count };
}

// The reason line (blueprint §9.4): the driving dimensions as fixed,
// abstract phrases -- never plot, never a sensitive trait -- or null when
// nothing lifted the title above the pool (an honest absence, not filler).
export function formatReason(reason: RecommendationReason | undefined, lang: Lang): string | null {
  if (!reason || reason.features.length === 0) return null;
  // A key this build has no words for (a newer family, ADR-69) or a spoiler
  // dimension is skipped, never a crash: the reason is best-effort copy.
  const copy = FEATURE_REASON_COPY[lang] as Partial<Record<string, { higher: string; lower: string }>>;
  const phrases = reason.features
    .filter((feature) => !SPOILER_DIMENSIONS.has(feature.key))
    .map((feature) => copy[feature.key]?.[feature.direction])
    .filter((phrase): phrase is string => Boolean(phrase));
  if (phrases.length === 0) return null;
  return lang === 'ar' ? `ما يقرّبه من ذوقك: ${phrases.join('، ')}.` : `What brings it close to your taste: ${phrases.join(', ')}.`;
}

// One numeral system in both languages: Latin digits (identity decision Q12,
// docs/IDENTITY_DECISIONS_2026-09-03.md -- 9 of 9 measured Arabic-language
// film/streaming sites, Gulf and Egypt, use Latin digits; our data sources are
// English). This supersedes mockup review P10, which asked for Arabic-Indic
// digits in Arabic. Arabic grouping/decimal separators are kept via `nu-latn`.
export function formatNumber(value: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US').format(value);
}

// Gregorian in both languages (ar-SA would default to the Umm al-Qura
// calendar), Latin digits like formatNumber.
export function formatDate(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-US', { dateStyle: 'medium' }).format(
    new Date(iso),
  );
}
