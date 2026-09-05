import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GENRE_LABEL, genreLabel } from '../lib/genres';

// The catalogue fixture is the vocabulary's only producer (fetch-catalog.ts
// folds every Wikidata label into a fixed set before writing it). Reading it
// here is what makes this a guard and not a restatement: a title added with a
// genre this build has no Arabic word for fails the suite instead of shipping
// an English chip onto an Arabic page (remediation brief P1-05 / L10N-01).
const CATALOGUE = path.resolve(__dirname, '../../../backend/src/scripts/fixtures/catalog.demo.json');

function catalogueGenres(): string[] {
  const titles = JSON.parse(readFileSync(CATALOGUE, 'utf8')) as { genres?: string[] | null }[];
  return [...new Set(titles.flatMap((title) => title.genres ?? []))].sort();
}

describe('genre vocabulary', () => {
  it('has an Arabic word for every genre in the catalogue', () => {
    const missing = catalogueGenres().filter((genre) => !GENRE_LABEL[genre]);
    expect(missing).toEqual([]);
  });

  it('translates in Arabic and keeps the key in English', () => {
    expect(genreLabel('Science Fiction', 'ar')).toBe('خيال علمي');
    expect(genreLabel('Science Fiction', 'en')).toBe('Science Fiction');
  });

  it('falls back to the key rather than blanking an unknown genre', () => {
    expect(genreLabel('Mockumentary', 'ar')).toBe('Mockumentary');
  });

  it('carries no empty label in either language', () => {
    for (const [genre, labels] of Object.entries(GENRE_LABEL)) {
      expect(labels.ar, genre).toBeTruthy();
      expect(labels.en, genre).toBeTruthy();
    }
  });
});
