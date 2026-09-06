import { describe, expect, it } from 'vitest';

import { bucketFor, hasTmdbId, parsePosterCount } from './check-poster-multi-feasibility.lib';

describe('hasTmdbId', () => {
  it('is true only when a TMDB id is present', () => {
    expect(hasTmdbId({ internalId: 'x', externalIds: { tmdb: '123' } })).toBe(true);
    expect(hasTmdbId({ internalId: 'x', externalIds: { tmdb: null } })).toBe(false);
    expect(hasTmdbId({ internalId: 'x', externalIds: {} })).toBe(false);
    expect(hasTmdbId({ internalId: 'x' })).toBe(false);
  });
});

describe('parsePosterCount', () => {
  it('counts the posters array on a 200 response', () => {
    expect(parsePosterCount(200, JSON.stringify({ posters: [{}, {}, {}] }))).toBe(3);
    expect(parsePosterCount(200, JSON.stringify({ posters: [] }))).toBe(0);
  });

  it('is null, never guessed, when the request failed or the shape is unexpected', () => {
    expect(parsePosterCount(404, JSON.stringify({ success: false, status_message: 'not found' }))).toBeNull();
    expect(parsePosterCount(200, JSON.stringify({}))).toBeNull();
    expect(parsePosterCount(200, 'not json')).toBeNull();
  });
});

describe('bucketFor', () => {
  it('classifies by poster count, with 2+ as the multi-poster-eligible bucket', () => {
    expect(bucketFor(null)).toBe('request_failed');
    expect(bucketFor(0)).toBe('zero');
    expect(bucketFor(1)).toBe('one');
    expect(bucketFor(2)).toBe('multi');
    expect(bucketFor(24)).toBe('multi');
  });
});
