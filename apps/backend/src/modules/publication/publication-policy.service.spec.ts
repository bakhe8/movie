import { describe, expect, it } from 'vitest';
import { SourceRecord } from '../../entities/source-record.entity';
import { Title } from '../../entities/title.entity';
import { PublicationPolicyService, PUBLICATION_POLICY_VERSION } from './publication-policy.service';

function title(overrides: Partial<Title> = {}): Title {
  return {
    id: 't1',
    internalId: 'FILM001',
    titleEn: 'A Film',
    titleAr: 'فيلم',
    description: 'A description.',
    releaseYear: 2020,
    genres: ['drama'],
    originalLanguage: 'ar',
    posterPath: '/poster.jpg',
    externalIds: {},
    fingerprint: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Title;
}

function sourceRecord(overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    id: 'sr1',
    title: null,
    titleId: 't1',
    fieldName: 'posterPath',
    value: null,
    source: 'tmdb',
    license: null,
    licenseStatus: 'unknown',
    allowsStorage: null,
    allowsDerivation: null,
    allowsTraining: null,
    attributionRequired: null,
    retentionUntil: null,
    fallbackPlan: null,
    confidence: null,
    extractorVersion: null,
    reviewStatus: null,
    supersededByRecord: null,
    supersededBy: null,
    retrievedAt: null,
    validFrom: null,
    createdAt: new Date(),
    ...overrides,
  } as SourceRecord;
}

describe('PublicationPolicyService (public-v1)', () => {
  const policy = new PublicationPolicyService();

  it('is ready when every required field is present and no source record has expired', () => {
    const result = policy.evaluate(title(), [sourceRecord()]);
    expect(result).toEqual({
      titleId: 't1',
      policyVersion: PUBLICATION_POLICY_VERSION,
      blockerCodes: [],
      ready: true,
    });
  });

  it('is ready with zero cited source records', () => {
    expect(policy.evaluate(title(), []).ready).toBe(true);
  });

  it('flags POSTER_MISSING when posterPath is null', () => {
    const result = policy.evaluate(title({ posterPath: null }), []);
    expect(result.blockerCodes).toEqual(['POSTER_MISSING']);
    expect(result.ready).toBe(false);
  });

  it('flags DESCRIPTION_MISSING for null and for whitespace-only description', () => {
    expect(policy.evaluate(title({ description: null as unknown as string }), []).blockerCodes).toContain(
      'DESCRIPTION_MISSING',
    );
    expect(policy.evaluate(title({ description: '   ' }), []).blockerCodes).toContain('DESCRIPTION_MISSING');
  });

  it('flags GENRES_MISSING for null and for an empty array', () => {
    expect(policy.evaluate(title({ genres: null as unknown as string[] }), []).blockerCodes).toContain(
      'GENRES_MISSING',
    );
    expect(policy.evaluate(title({ genres: [] }), []).blockerCodes).toContain('GENRES_MISSING');
  });

  it('accumulates every missing-field blocker at once, never stopping at the first', () => {
    const result = policy.evaluate(title({ posterPath: null, description: null as unknown as string, genres: [] }), []);
    expect(result.blockerCodes).toEqual(['POSTER_MISSING', 'DESCRIPTION_MISSING', 'GENRES_MISSING']);
  });

  it('does not block on licenseStatus alone, even unknown or pending_review (ADR-72, free launch)', () => {
    const records = [
      sourceRecord({ licenseStatus: 'unknown' }),
      sourceRecord({ id: 'sr2', licenseStatus: 'pending_review' }),
      sourceRecord({ id: 'sr3', licenseStatus: 'non_commercial_only' }),
    ];
    expect(policy.evaluate(title(), records).blockerCodes).toEqual([]);
  });

  it('flags LICENSE_BLOCKED only when a cited record\'s retentionUntil has passed', () => {
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 1000 * 60 * 60);

    expect(policy.evaluate(title(), [sourceRecord({ retentionUntil: past })]).blockerCodes).toEqual([
      'LICENSE_BLOCKED',
    ]);
    expect(policy.evaluate(title(), [sourceRecord({ retentionUntil: future })]).blockerCodes).toEqual([]);
    expect(policy.evaluate(title(), [sourceRecord({ retentionUntil: null })]).blockerCodes).toEqual([]);
  });
});
