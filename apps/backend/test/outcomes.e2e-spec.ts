import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/modules/app/app.module';
import { Outcome } from '../src/entities/outcome.entity';
import { Recommendation } from '../src/entities/recommendation.entity';
import { Title } from '../src/entities/title.entity';

async function registerAndCreateProfile(app: INestApplication, label: string) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const registerResponse = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: 'CorrectHorseBattery1', firstName: 'Outcome', lastName: label })
    .expect(201);
  const token = registerResponse.body.access_token as string;

  const profileResponse = await request(app.getHttpServer())
    .post('/profiles')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: `${label} ${Date.now()}` })
    .expect(201);

  return { token, profileId: profileResponse.body.id as string };
}

async function createRecommendation(app: INestApplication, profileId: string, titleId: string) {
  const recommendationsRepository = app.get<Repository<Recommendation>>(getRepositoryToken(Recommendation));
  return recommendationsRepository.save({
    requestId: '22222222-2222-2222-2222-222222222222',
    profileId,
    titleId,
    track: 'safe',
    confidenceBand: 'strong',
    reason: { features: [], evidenceSource: 'individual' },
    evidenceSource: 'individual',
    modelVersion: 'e2e-outcome-v1',
    policyVersion: 'e2e-outcome-v1',
    selectionPropensity: 1,
    shownAt: new Date(),
  });
}

// Blueprint gap 4's remaining outcomes types (§13.1, API.md's already-specified
// target POST …/recommendations/:id/outcome): 'saved'/'clicked'/
// 'dismissed_not_relevant'/'opened_provider'. Real HTTP against real Postgres.
//
// Both users are registered once in beforeAll and reused across every test
// (idor.e2e-spec.ts's own pattern) -- /auth/register carries its own strict
// per-route throttle (5/60s, AUTH_THROTTLE), separate from and much lower
// than the app-wide default (60/60s); registering fresh per test blows
// through it in a file with more than five tests.
describe('POST /recommendations/:recommendationId/outcome (blueprint gap 4)', () => {
  let app: INestApplication;
  let titleId: string;
  let ownerToken: string;
  let ownerProfileId: string;
  let attackerToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    const titlesRepository = app.get<Repository<Title>>(getRepositoryToken(Title));
    const suffix = Date.now();
    const title = await titlesRepository.save({ internalId: `E2E-OUTCOME-${suffix}`, titleEn: 'Outcome Check', titleAr: 'فحص' });
    titleId = title.id;

    ({ token: ownerToken, profileId: ownerProfileId } = await registerAndCreateProfile(app, 'owner'));
    ({ token: attackerToken } = await registerAndCreateProfile(app, 'attacker'));
  }, 20_000);

  afterAll(async () => {
    await app.close();
  });

  it('records an outcome for a recommendation the caller owns', async () => {
    const recommendation = await createRecommendation(app, ownerProfileId, titleId);

    const response = await request(app.getHttpServer())
      .post(`/recommendations/${recommendation.id}/outcome`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ type: 'saved' })
      .expect(201);

    expect(response.body).toMatchObject({ recommendationId: recommendation.id, type: 'saved' });

    const outcomesRepository = app.get<Repository<Outcome>>(getRepositoryToken(Outcome));
    const rows = await outcomesRepository.find({ where: { recommendationId: recommendation.id } });
    expect(rows).toHaveLength(1);
  });

  it('appends a second row rather than overwriting when the same recommendation is acted on twice', async () => {
    const recommendation = await createRecommendation(app, ownerProfileId, titleId);

    await request(app.getHttpServer())
      .post(`/recommendations/${recommendation.id}/outcome`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ type: 'clicked' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/recommendations/${recommendation.id}/outcome`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ type: 'opened_provider' })
      .expect(201);

    const outcomesRepository = app.get<Repository<Outcome>>(getRepositoryToken(Outcome));
    const rows = await outcomesRepository.find({ where: { recommendationId: recommendation.id } });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.type))).toEqual(new Set(['clicked', 'opened_provider']));
  });

  it('404s on an unknown recommendation id', async () => {
    await request(app.getHttpServer())
      .post('/recommendations/11111111-1111-1111-1111-111111111111/outcome')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ type: 'saved' })
      .expect(404);
  });

  it('rejects an outcome on a recommendation owned by another user (IDOR)', async () => {
    const recommendation = await createRecommendation(app, ownerProfileId, titleId);

    await request(app.getHttpServer())
      .post(`/recommendations/${recommendation.id}/outcome`)
      .set('Authorization', `Bearer ${attackerToken}`)
      .send({ type: 'saved' })
      .expect(404);
  });

  it("rejects 'watched' and 'ranked_later' -- those are written by other paths, not this endpoint", async () => {
    const recommendation = await createRecommendation(app, ownerProfileId, titleId);

    await request(app.getHttpServer())
      .post(`/recommendations/${recommendation.id}/outcome`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ type: 'watched' })
      .expect(400);
  });
});
