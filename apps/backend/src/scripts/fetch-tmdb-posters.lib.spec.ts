import { describe, expect, it } from 'vitest';

import { needsPoster, parsePosterResponse } from './fetch-tmdb-posters.lib';

describe('needsPoster', () => {
  it('is a candidate only with a TMDB id and an unchecked (or forced) poster', () => {
    expect(needsPoster({ internalId: 'x', externalIds: { tmdb: '123' } })).toBe(true);
    expect(needsPoster({ internalId: 'x', externalIds: {} })).toBe(false);
    expect(needsPoster({ internalId: 'x' })).toBe(false);
    expect(needsPoster({ internalId: 'x', externalIds: { tmdb: '123' }, posterPath: '/abc.jpg' })).toBe(false);
    expect(needsPoster({ internalId: 'x', externalIds: { tmdb: '123' }, posterPath: null })).toBe(false); // already checked, TMDB has none
    expect(needsPoster({ internalId: 'x', externalIds: { tmdb: '123' }, posterPath: '/abc.jpg' }, true)).toBe(true);
  });
});

describe('parsePosterResponse', () => {
  it('returns the path TMDB gives, exactly as given', () => {
    expect(parsePosterResponse(200, JSON.stringify({ poster_path: '/abc123.jpg' }))).toBe('/abc123.jpg');
  });

  it('is null, never fabricated, when TMDB reports no poster or the request failed', () => {
    expect(parsePosterResponse(200, JSON.stringify({ poster_path: null }))).toBeNull();
    expect(parsePosterResponse(200, JSON.stringify({}))).toBeNull();
    expect(parsePosterResponse(404, JSON.stringify({ success: false, status_message: 'not found' }))).toBeNull();
    expect(parsePosterResponse(200, 'not json')).toBeNull();
    expect(parsePosterResponse(200, JSON.stringify({ poster_path: '' }))).toBeNull();
  });
});
