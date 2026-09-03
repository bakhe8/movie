import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/modules/app/app.module';
import { Title } from '../src/entities/title.entity';
import { User } from '../src/entities/user.entity';
import { UserModelSnapshot } from '../src/entities/user-model-snapshot.entity';
import { UserTitleState } from '../src/entities/user-title-state.entity';
import { AuthService } from '../src/modules/auth/auth.service';

const PASSWORD = 'CorrectHorseBattery1';

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
const FINGERPRINT_V3_DIMENSIONS = [
  'rhythm.setupLength',
  'rhythm.turningPointDensity',
  'rhythm.deliberateness',
  'information.expositionDirectness',
  'information.subtext',
  'information.knowledgeComplexity',
  'style.stylization',
  'style.experimentation',
  'style.scale',
  'tone.playfulness',
  'tone.sentimentality',
  'narrative.scope',
] as const;
const FINGERPRINT_DIMENSIONS = [...FINGERPRINT_V1_DIMENSIONS, ...FINGERPRINT_V2_DIMENSIONS, ...FINGERPRINT_V3_DIMENSIONS] as const;

function fullFingerprint(overrides: Record<string, number> = {}) {
  const base = FINGERPRINT_V1_DIMENSIONS.reduce<Record<string, number>>((acc, dim) => {
    acc[dim] = overrides[dim] ?? 0.5;
    return acc;
  }, {});
  const v2Features = FINGERPRINT_V2_DIMENSIONS.reduce<Record<string, number>>((acc, dim) => {
    acc[dim] = overrides[dim] ?? 0.5;
    return acc;
  }, {});
  const v3Features = FINGERPRINT_V3_DIMENSIONS.reduce<Record<string, number>>((acc, dim) => {
    acc[dim] = overrides[dim] ?? 0.5;
    return acc;
  }, {});
  return {
    schemaVersion: 'film-fingerprint-v1' as const,
    ...base,
    themes: [],
    confidence: {},
    v2: { schemaVersion: 'film-fingerprint-v2' as const, features: v2Features, themes: [], confidence: {} },
    v3: { schemaVersion: 'film-fingerprint-v3' as const, features: v3Features, confidence: {} },
  };
}

async function createProfile(app: INestApplication, token: string, label: string) {
  const response = await request(app.getHttpServer())
    .post('/profiles')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: `${label} ${Date.now()}` })
    .expect(201);
  return response.body.id as string;
}

// F10, BP §18.1: activating a model_versions row is documented as the
// product's rollback control (AdminModelsService.updateModel(), enforcing at
// most one active row), but until this landed nothing ever read `active`
// back -- RecommendationsService.loadSnapshot() always served each profile's
// newest snapshot regardless of which version an admin pinned, so
// "activating" a version had no observable effect on what was actually
// served. Real HTTP against real Postgres, not the mocked-repository unit
// tests in recommendations.service.spec.ts.
describe('Recommendation serving honors the model_versions.active pin (F10, BP §18.1 rollback)', () => {
  let app: INestApplication;
  let adminToken: string;
  let userToken: string;
  let profileId: string;
  let titleId: string;
  let olderVersion: string;
  let newerVersion: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const users = app.get<Repository<User>>(getRepositoryToken(User));
    const auth = app.get(AuthService);

    const adminAccount = await auth.register({ email: `rollback-admin-${suffix}@example.com`, password: PASSWORD, firstName: 'Roll', lastName: 'Admin' });
    await users.update({ id: adminAccount.user.id as string }, { role: 'admin' });
    adminToken = (await auth.login({ email: `rollback-admin-${suffix}@example.com`, password: PASSWORD })).access_token;

    const plainAccount = await auth.register({ email: `rollback-user-${suffix}@example.com`, password: PASSWORD, firstName: 'Roll', lastName: 'User' });
    userToken = plainAccount.access_token;
    profileId = await createProfile(app, userToken, 'rollback');

    const titlesRepository = app.get<Repository<Title>>(getRepositoryToken(Title));
    const title = await titlesRepository.save({
      internalId: `E2E-ROLLBACK-${suffix}`,
      titleEn: 'Rollback Check',
      titleAr: 'فحص التراجع',
      fingerprint: fullFingerprint({ warmth: 0.9 }) as never,
    });
    titleId = title.id;

    // findForProfile() candidates are every fingerprinted title in the whole
    // database minus this profile's watched ones -- postgres-test is shared
    // and accumulates fingerprinted titles across other e2e specs, so mark
    // every other one watched for this fresh profile (same exclusion the
    // service already applies for real usage) to make this title the only
    // candidate, deterministically, regardless of accumulated data.
    const otherFingerprintedTitles = await titlesRepository
      .createQueryBuilder('title')
      .where('title.fingerprint IS NOT NULL')
      .andWhere('title.id != :titleId', { titleId })
      .getMany();
    if (otherFingerprintedTitles.length > 0) {
      const statesRepository = app.get<Repository<UserTitleState>>(getRepositoryToken(UserTitleState));
      await statesRepository.save(
        otherFingerprintedTitles.map((other) => ({
          profileId,
          titleId: other.id,
          state: 'watched' as const,
          watchedAt: new Date(),
        })),
      );
    }

    olderVersion = `e2e-rollback-old-${suffix}`;
    newerVersion = `e2e-rollback-new-${suffix}`;
    for (const version of [olderVersion, newerVersion]) {
      await request(app.getHttpServer())
        .post('/admin/models')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ version, rankerType: 'plackett-luce', fingerprintSchemaVersion: 'v1+v2+v3' })
        .expect(201);
    }

    // Two snapshots for the same profile, same as a profile trained once
    // under an earlier model version and again after an upgrade -- the newer
    // one is the "latest" the pre-F10 code always served regardless of pin.
    const snapshotsRepository = app.get<Repository<UserModelSnapshot>>(getRepositoryToken(UserModelSnapshot));
    await snapshotsRepository.save({
      profileId,
      weights: FINGERPRINT_DIMENSIONS.map(() => 0),
      biasTerms: {},
      modelVersion: olderVersion,
      trainingTriadCount: 10,
    });
    await snapshotsRepository.save({
      profileId,
      weights: FINGERPRINT_DIMENSIONS.map(() => 0),
      biasTerms: {},
      modelVersion: newerVersion,
      trainingTriadCount: 20,
    });
  }, 20_000);

  afterAll(async () => {
    await app.close();
  });

  it('serves the newest snapshot when no model version is pinned active, same as before F10', async () => {
    const response = await request(app.getHttpServer())
      .get(`/profiles/${profileId}/recommendations`)
      .set('Authorization', `Bearer ${userToken}`)
      .query({ limit: 1 })
      .expect(200);

    expect(response.body[0].title.id).toBe(titleId);
    expect(response.body[0].modelVersion).toBe(newerVersion);
  });

  it('serves the snapshot trained under the pinned version once an admin activates it -- the rollback actually takes effect', async () => {
    await request(app.getHttpServer())
      .patch(`/admin/models/${olderVersion}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: true })
      .expect(200);

    const response = await request(app.getHttpServer())
      .get(`/profiles/${profileId}/recommendations`)
      .set('Authorization', `Bearer ${userToken}`)
      .query({ limit: 1 })
      .expect(200);

    expect(response.body[0].modelVersion).toBe(olderVersion);
  });

  it('falls back to the newest snapshot again once the pin is cleared', async () => {
    await request(app.getHttpServer())
      .patch(`/admin/models/${olderVersion}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: false })
      .expect(200);

    const response = await request(app.getHttpServer())
      .get(`/profiles/${profileId}/recommendations`)
      .set('Authorization', `Bearer ${userToken}`)
      .query({ limit: 1 })
      .expect(200);

    expect(response.body[0].modelVersion).toBe(newerVersion);
  });
});
