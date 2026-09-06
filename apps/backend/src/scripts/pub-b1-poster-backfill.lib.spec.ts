import { describe, expect, it } from 'vitest';
import { EXTRACTOR_VERSION, parseTmdbPosterPath, tmdbPosterSourceRecordRow } from './pub-b1-poster-backfill.lib';

describe('parseTmdbPosterPath', () => {
  it('returns the poster path from a valid TMDB body', () => {
    expect(parseTmdbPosterPath(JSON.stringify({ poster_path: '/abc123.jpg' }))).toBe('/abc123.jpg');
  });

  it('returns null when TMDB reports no poster', () => {
    expect(parseTmdbPosterPath(JSON.stringify({ poster_path: null }))).toBeNull();
    expect(parseTmdbPosterPath(JSON.stringify({ poster_path: '' }))).toBeNull();
    expect(parseTmdbPosterPath(JSON.stringify({}))).toBeNull();
  });

  it('returns null rather than throwing on malformed JSON', () => {
    expect(parseTmdbPosterPath('not json')).toBeNull();
  });
});

describe('tmdbPosterSourceRecordRow', () => {
  it('builds the same rights-registry shape the catalog already uses for TMDB posters', () => {
    const row = tmdbPosterSourceRecordRow('/abc123.jpg');
    expect(row).toMatchObject({
      fieldName: 'posterPath',
      value: 'https://image.tmdb.org/t/p/original/abc123.jpg',
      source: 'tmdb',
      licenseStatus: 'non_commercial_only',
      allowsStorage: true,
      allowsDerivation: false,
      allowsTraining: false,
      attributionRequired: true,
    });
  });
});

describe('EXTRACTOR_VERSION', () => {
  it('is scoped to this script, distinct from load-catalog-rights.ts', () => {
    expect(EXTRACTOR_VERSION).toBe('pub-b1-poster-backfill-v1');
  });
});
