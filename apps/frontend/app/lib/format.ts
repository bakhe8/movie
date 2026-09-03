// The only path from a model value to the screen (ADR-33 §5). Every surface
// that shows a prediction -- recommendations, taste profile, work page,
// library ranking -- formats through these helpers, so a raw score or a
// percentage cannot reach the user by accident.
import type { ConfidenceBand } from './api';
import { CONFIDENCE_BAND_COPY } from './copy';

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

// One numeral system per locale (mockup review P10): Arabic-Indic digits in
// Arabic, Latin digits in English.
export function formatNumber(value: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-SA' : 'en-US').format(value);
}

// Gregorian in both languages (ar-SA would default to the Umm al-Qura
// calendar), digits following the locale like formatNumber.
export function formatDate(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-ca-gregory' : 'en-US', { dateStyle: 'medium' }).format(
    new Date(iso),
  );
}
