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
import { UserTitleState } from '../src/entities/user-title-state.entity';
import { WatchEvent } from '../src/entities/watch-event.entity';

async function registerAndCreateProfile(app: INestApplication, label: string) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const registerResponse = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: 'CorrectHorseBattery1', firstName: 'Watch', lastName: label })
    .expect(201);
  const token = registerResponse.body.access_token as string;

  const profileResponse = await request(app.getHttpServer())
    .post('/profiles')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: `${label} ${Date.now()}` })
    .expect(201);

  return { token, profileId: profileResponse.body.id as string };
}

// Blueprint gap 4's other half (§4.5, the post-watch loop): a shown
// recommendation had nowhere to record an actual watch, so `outcomes`/
// `watch_events` existed as schema only. Real HTTP against real Postgres,
// not just the mocked-repository unit tests -- the whole point is what
// actually lands in three different tables from one POST.
describe('POST /profiles/:profileId/watch-events (blueprint gap 4, §4.5)', () => {
  let app: INestApplication;
  let titleId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    const titlesRepository = app.get<Repository<Title>>(getRepositoryToken(Title));
    const suffix = Date.now();
    const title = await titlesRepository.save({ internalId: `E2E-WATCH-${suffix}`, titleEn: 'Watch Check', titleAr: 'فحص' });
    titleId = title.id;
  }, 20_000);

  afterAll(async () => {
    await app.close();
  });

  it('records a watch event with no linked recommendation and still marks the title watched', async () => {
    const { token, profileId } = await registerAndCreateProfile(app, 'no-rec');

    const response = await request(app.getHttpServer())
      .post(`/profiles/${profileId}/watch-events`)
      .set('Authorization', `Bearer ${token}`)
      .send({ titleId, source: 'manual' })
      .expect(201);

    expect(response.body).toMatchObject({ profileId, titleId, source: 'manual', recommendationId: null });

    const watchEventsRepository = app.get<Repository<WatchEvent>>(getRepositoryToken(WatchEvent));
    const rows = await watchEventsRepository.find({ where: { profileId, titleId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].recommendationId).toBeNull();
    // No outcomes row can exist for this watch: recommendationId is NOT NULL
    // on outcomes (SCHEMA.md), so with no recommendation to link there is
    // nothing to query for -- covered precisely (outcomesRepository.save
    // never called) by the mocked-repository unit test instead, since
    // postgres-test is shared across this whole e2e run/session and an
    // unscoped outcomesRepository.find() here would pick up rows from
    // other tests/runs, not prove anything about this one.

    // BP §4.5: the watched title "returns to appropriate triads" -- checked
    // via the same user_title_states row PATCH .../state writes.
    const statesRepository = app.get<Repository<UserTitleState>>(getRepositoryToken(UserTitleState));
    const state = await statesRepository.findOne({ where: { profileId, titleId } });
    expect(state?.state).toBe('watched');
    expect(state?.watchedAt).not.toBeNull();
  });

  it('links the most recent shown recommendation and writes an outcomes row closing the loop', async () => {
    const { token, profileId } = await registerAndCreateProfile(app, 'with-rec');

    const recommendationsRepository = app.get<Repository<Recommendation>>(getRepositoryToken(Recommendation));
    const recommendation = await recommendationsRepository.save({
      requestId: '11111111-1111-1111-1111-111111111111',
      profileId,
      titleId,
      track: 'safe',
      confidenceBand: 'strong',
      reason: { features: [], evidenceSource: 'individual' },
      evidenceSource: 'individual',
      modelVersion: 'e2e-watch-v1',
      policyVersion: 'e2e-watch-v1',
      selectionPropensity: 1,
      shownAt: new Date(),
    });

    const response = await request(app.getHttpServer())
      .post(`/profiles/${profileId}/watch-events`)
      .set('Authorization', `Bearer ${token}`)
      .send({ titleId, source: 'in_app' })
      .expect(201);

    expect(response.body.recommendationId).toBe(recommendation.id);

    const outcomesRepository = app.get<Repository<Outcome>>(getRepositoryToken(Outcome));
    const outcomes = await outcomesRepository.find({ where: { recommendationId: recommendation.id } });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].type).toBe('watched');
  });

  it('rejects recording a watch for a profile owned by another user (IDOR)', async () => {
    const { profileId } = await registerAndCreateProfile(app, 'victim');
    const { token: attackerToken } = await registerAndCreateProfile(app, 'attacker');

    await request(app.getHttpServer())
      .post(`/profiles/${profileId}/watch-events`)
      .set('Authorization', `Bearer ${attackerToken}`)
      .send({ titleId, source: 'in_app' })
      .expect(404);
  });

  it('rejects a body with an unknown field (no rating/liking signal accepted, whitelist validation)', async () => {
    const { token, profileId } = await registerAndCreateProfile(app, 'no-rating');

    await request(app.getHttpServer())
      .post(`/profiles/${profileId}/watch-events`)
      .set('Authorization', `Bearer ${token}`)
      .send({ titleId, source: 'in_app', rating: 5 })
      .expect(400);
  });
});
