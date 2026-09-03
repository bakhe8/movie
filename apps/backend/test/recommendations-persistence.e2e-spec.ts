import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/modules/app/app.module';
import { Recommendation } from '../src/entities/recommendation.entity';
import { Title } from '../src/entities/title.entity';
import { UserModelSnapshot } from '../src/entities/user-model-snapshot.entity';
import { UserTitleState } from '../src/entities/user-title-state.entity';

const FINGERPRINT_V1_DIMENSIONS = [
  'pacing',
  'rhythmVariance',
  'ambiguity',
  'psychologicalDepth',
  'warmth',
  'darkness',
  'linearity',
  'dialogueDensity',
  'actionIntensity',
  'plotComplexity',
  'visualComplexity',
  'soundscapeComplexity',
  'colorSaturation',
] as const;
// ADR-69: matches title-fingerprint.type.ts's FINGERPRINT_V2_DIMENSIONS.
const FINGERPRINT_V2_DIMENSIONS = [
  'narrative.revelation',
  'narrative.perspective',
  'narrative.unreliability',
  'tone.irony',
  'tone.unease',
  'tone.catharsis',
  'tone.compassion',
  'characters.agency',
  'characters.moralAmbiguity',
  'characters.transformation',
  'characters.relationshipCentrality',
  'ending.openness',
  'ending.twist',
  'ending.justice',
  'ending.optimism',
] as const;
const FINGERPRINT_DIMENSIONS = [...FINGERPRINT_V1_DIMENSIONS, ...FINGERPRINT_V2_DIMENSIONS] as const;

// V1 keys flat at the top level, V2 keys nested under fingerprint.v2.features
// -- the real published shape (FINGERPRINT_SCHEMA.md §3.1).
function fullFingerprint(overrides: Record<string, number> = {}) {
  const base = FINGERPRINT_V1_DIMENSIONS.reduce<Record<string, number>>((acc, dim) => {
    acc[dim] = overrides[dim] ?? 0.5;
    return acc;
  }, {});
  const features = FINGERPRINT_V2_DIMENSIONS.reduce<Record<string, number>>((acc, dim) => {
    acc[dim] = overrides[dim] ?? 0.5;
    return acc;
  }, {});
  return {
    schemaVersion: 'film-fingerprint-v1' as const,
    ...base,
    themes: [],
    confidence: {},
    v2: { schemaVersion: 'film-fingerprint-v2' as const, features, themes: [], confidence: {} },
  };
}

async function registerUser(app: INestApplication, label: string) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const response = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: 'CorrectHorseBattery1', firstName: 'Rec', lastName: label })
    .expect(201);
  return response.body.access_token as string;
}

async function createProfile(app: INestApplication, token: string, label: string) {
  const response = await request(app.getHttpServer())
    .post('/profiles')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: `${label} ${Date.now()}` })
    .expect(201);
  return response.body.id as string;
}

// Blueprint gap 4 (recommendations never persisted, ADR-58): findForProfile
// must write one `recommendations` row per result actually returned, real
// HTTP against real Postgres -- not just the mocked-repository unit tests.
describe('Recommendation persistence (real HTTP, real DB, blueprint gap 4)', () => {
  let app: INestApplication;
  let titleIds: string[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const titlesRepository = app.get<Repository<Title>>(getRepositoryToken(Title));
    const suffix = Date.now();
    const titles = await titlesRepository.save([
      { internalId: `E2E-REC-A-${suffix}`, titleEn: 'Rec Check A', titleAr: 'أ', fingerprint: fullFingerprint({ warmth: 0.9 }) },
      { internalId: `E2E-REC-B-${suffix}`, titleEn: 'Rec Check B', titleAr: 'ب', fingerprint: fullFingerprint({ warmth: 0.1 }) },
    ]);
    titleIds = titles.map((title) => title.id);
  }, 20_000);

  afterAll(async () => {
    await app.close();
  });

  it('writes one recommendations row per shown result, sharing a requestId, and never leaks into another profile', async () => {
    const token = await registerUser(app, 'persist-check');
    const profileId = await createProfile(app, token, 'Persist check');

    // findForProfile() candidates are every fingerprinted title in the whole
    // database minus this profile's watched ones (by design -- recommend
    // from the full catalog, not just titles this profile has touched).
    // postgres-test is shared and accumulates fingerprinted titles across
    // many other e2e specs' beforeAll hooks over this disposable container's
    // life, so without isolating the pool, which two titles land in the
    // top-`limit` here depends on whatever else happens to exist at run
    // time. Mark every other fingerprinted title watched for this fresh
    // profile -- the same exclusion the service already applies for real
    // usage -- so this test's own two titles are the only candidates left,
    // deterministically, regardless of accumulated data.
    const titlesRepository = app.get<Repository<Title>>(getRepositoryToken(Title));
    const otherFingerprintedTitles = await titlesRepository
      .createQueryBuilder('title')
      .where('title.fingerprint IS NOT NULL')
      .andWhere('title.id NOT IN (:...titleIds)', { titleIds })
      .getMany();
    if (otherFingerprintedTitles.length > 0) {
      const statesRepository = app.get<Repository<UserTitleState>>(getRepositoryToken(UserTitleState));
      await statesRepository.save(
        otherFingerprintedTitles.map((title) => ({
          profileId,
          titleId: title.id,
          state: 'watched' as const,
          watchedAt: new Date(),
        })),
      );
    }

    const snapshotsRepository = app.get<Repository<UserModelSnapshot>>(getRepositoryToken(UserModelSnapshot));
    await snapshotsRepository.save({
      profileId,
      weights: FINGERPRINT_DIMENSIONS.map((dim) => (dim === 'warmth' ? 1 : 0)),
      biasTerms: {},
      modelVersion: 'e2e-persist-v1',
      trainingTriadCount: 25,
    });

    const response = await request(app.getHttpServer())
      .get(`/profiles/${profileId}/recommendations`)
      .set('Authorization', `Bearer ${token}`)
      .query({ limit: 2 })
      .expect(200);
    expect(response.body).toHaveLength(2);
    const shownTitleIds = (response.body as Array<{ title: { id: string } }>).map((item) => item.title.id);
    expect(new Set(shownTitleIds)).toEqual(new Set(titleIds));

    const recommendationsRepository = app.get<Repository<Recommendation>>(getRepositoryToken(Recommendation));
    const rows = await recommendationsRepository.find({ where: { profileId } });

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.titleId))).toEqual(new Set(titleIds));
    expect(rows.every((row) => row.modelVersion === 'e2e-persist-v1')).toBe(true);
    expect(rows.every((row) => row.track === 'safe')).toBe(true);
    expect(rows.every((row) => row.evidenceSource === 'individual')).toBe(true);
    expect(rows.every((row) => row.confidenceBand === 'strong')).toBe(true);
    // Both rows from the one call share a single requestId.
    expect(new Set(rows.map((row) => row.requestId)).size).toBe(1);
    expect(rows.every((row) => row.shownAt !== null)).toBe(true);
    // Honest nulls, not fabricated values -- no continuous confidence score,
    // no experiment, and today's full-catalog scan matches none of the
    // specified candidateSource values.
    expect(rows.every((row) => row.confidenceRaw === null)).toBe(true);
    expect(rows.every((row) => row.experimentId === null)).toBe(true);
    expect(rows.every((row) => row.candidateSource === null)).toBe(true);
    // Reason carries the same features/evidenceSource the API response does.
    const warmTitleRow = rows.find((row) => row.titleId === titleIds[0]);
    expect(warmTitleRow?.reason).toMatchObject({ evidenceSource: 'individual' });
  });
});
