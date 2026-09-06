import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/modules/app/app.module';
import { publishForTest } from './publish-for-test';
import { Outcome } from '../src/entities/outcome.entity';
import { Recommendation } from '../src/entities/recommendation.entity';
import { Title } from '../src/entities/title.entity';
import { Triad } from '../src/entities/triad.entity';
import { User } from '../src/entities/user.entity';
import { UserModelSnapshot } from '../src/entities/user-model-snapshot.entity';
import { AuthService } from '../src/modules/auth/auth.service';

const PASSWORD = 'CorrectHorseBattery1';

// The metrics board over real rows (BP §18.1): one account walks the funnel
// to "shown a result", its recommendations get a click, a watch and a later
// ranking, and the report separates them. A demo-domain account is excluded
// by parameter and must not move any number.
describe('GET /admin/metrics', () => {
  let app: INestApplication;
  let adminToken: string;
  let userToken: string;
  let profileId: string;
  let suffix: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    const auth = app.get(AuthService);
    const users = app.get<Repository<User>>(getRepositoryToken(User));
    suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const admin = await auth.register({ email: `metrics-admin-${suffix}@example.com`, password: PASSWORD, firstName: 'M', lastName: 'A' });
    await users.update({ id: admin.user.id as string }, { role: 'admin' });
    adminToken = (await auth.login({ email: `metrics-admin-${suffix}@example.com`, password: PASSWORD })).access_token;

    // The walker: uses the metrics-e2e.test domain so the test can scope to it.
    const walker = await auth.register({ email: `walker-${suffix}@metrics-e2e.test`, password: PASSWORD, firstName: 'W', lastName: 'K' });
    userToken = walker.access_token;
    const profile = await request(app.getHttpServer())
      .post('/profiles')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: `Walker ${suffix}`, market: 'SA' })
      .expect(201);
    profileId = profile.body.id;
    // market is written by the onboarding step (PATCH), not by create.
    await request(app.getHttpServer())
      .patch(`/profiles/${profileId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ market: 'SA' })
      .expect(200);

    const titles = app.get<Repository<Title>>(getRepositoryToken(Title));
    const saved = await titles.save(
      Array.from({ length: 3 }, (_, index) => ({ internalId: `E2E-METRICS-${suffix}-${index}`, titleEn: `Metrics ${index}`, titleAr: `مقاييس ${index}` })),
    );
    // PUB-G1: marking a title watched requires it to be published.
    await publishForTest(app, saved.map((title) => title.id));
    for (const title of saved) {
      await request(app.getHttpServer())
        .patch(`/profiles/${profileId}/titles/${title.id}/state`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ state: 'watched' })
        .expect(200);
    }
    const current = await request(app.getHttpServer()).get(`/profiles/${profileId}/triads/current`).set('Authorization', `Bearer ${userToken}`).expect(200);
    const triad = current.body as { id: string; titleIds: string[] };
    await request(app.getHttpServer())
      .post(`/triads/${triad.id}/rank`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ ranking: [...triad.titleIds] })
      .expect(201);
    // shownAt is stamped by the service; make the answer time measurable.
    const triads = app.get<Repository<Triad>>(getRepositoryToken(Triad));
    await triads.update({ id: triad.id }, { shownAt: new Date(Date.now() - 45_000) });

    const snapshots = app.get<Repository<UserModelSnapshot>>(getRepositoryToken(UserModelSnapshot));
    await snapshots.save(
      snapshots.create({
        profileId,
        weights: Array.from({ length: 28 }, () => 0.1),
        biasTerms: {},
        modelVersion: 'e2e-metrics-v1',
        trainingTriadCount: 7,
        pairwiseAccuracy: 0.9,
        heldOutTriadCount: 1,
        heldOutNll: 0.5,
        heldOutPairwiseAccuracy: 0.8,
      } as never),
    );

    const recommendations = app.get<Repository<Recommendation>>(getRepositoryToken(Recommendation));
    const outcomes = app.get<Repository<Outcome>>(getRepositoryToken(Outcome));
    const requestId = randomUUID();
    const shownAt = new Date(Date.now() - 3_600_000);
    const recs = await recommendations.save(
      saved.map((title, index) =>
        recommendations.create({
          requestId,
          profileId,
          titleId: title.id,
          track: index === 2 ? 'discovery' : 'safe',
          confidenceBand: index === 0 ? 'strong' : 'likely',
          reason: { features: [], evidenceSource: 'individual' },
          evidenceSource: 'individual',
          modelVersion: 'e2e-metrics-v1',
          policyVersion: 'e2e',
          selectionPropensity: 1,
          shownAt,
        }),
      ),
    );
    await outcomes.save([
      outcomes.create({ recommendationId: recs[0].id, type: 'clicked', occurredAt: new Date() }),
      outcomes.create({ recommendationId: recs[0].id, type: 'watched', occurredAt: new Date() }),
      outcomes.create({ recommendationId: recs[1].id, type: 'ranked_later', triadId: triad.id, rankPosition: 0, occurredAt: new Date() }),
      outcomes.create({ recommendationId: recs[2].id, type: 'dismissed_not_relevant', occurredAt: new Date() }),
    ]);
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  it('is admin-only', async () => {
    await request(app.getHttpServer()).get('/admin/metrics').expect(401);
    await request(app.getHttpServer()).get('/admin/metrics').set('Authorization', `Bearer ${userToken}`).expect(403);
  });

  it('reports the funnel, triad timing, and click / watch / later ranking as separate numbers', async () => {
    // Scope to the walker alone by excluding every other domain in the test DB.
    const response = await request(app.getHttpServer())
      .get('/admin/metrics?days=2&excludeDomains=example.com,demo.local,judge.local')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const report = response.body;

    expect(report.window).toMatchObject({ days: 2, excludeDomains: ['example.com', 'demo.local', 'judge.local'] });
    expect(report.accounts.usersTotal).toBeGreaterThanOrEqual(1);

    const steps = Object.fromEntries(report.funnel.steps.map((s: { step: string; count: number }) => [s.step, s.count]));
    expect(steps.registered).toBeGreaterThanOrEqual(1);
    expect(steps.onboarded).toBeGreaterThanOrEqual(1);
    expect(steps.watched_3).toBeGreaterThanOrEqual(1);
    expect(steps.first_triad).toBeGreaterThanOrEqual(1);
    expect(steps.trained).toBeGreaterThanOrEqual(1);
    expect(steps.shown_result).toBeGreaterThanOrEqual(1);
    expect(steps.three_triads).toBeLessThan(steps.first_triad + 1);

    expect(report.triads.completed).toBeGreaterThanOrEqual(1);
    expect(report.triads.answerSeconds.samples).toBeGreaterThanOrEqual(1);
    expect(report.triads.answerSeconds.median).toBeGreaterThanOrEqual(40);
    expect(report.triads.byPolicy['random-v2']).toBeGreaterThanOrEqual(1);

    expect(report.recommendations.shown).toBeGreaterThanOrEqual(3);
    expect(report.recommendations.byTrack).toMatchObject({ safe: expect.any(Number), discovery: expect.any(Number) });
    expect(report.recommendations.byBand).toMatchObject({ strong: expect.any(Number), likely: expect.any(Number) });
    expect(report.recommendations.outcomes.clicked).toBeGreaterThanOrEqual(1);
    expect(report.recommendations.outcomes.watched).toBeGreaterThanOrEqual(1);
    expect(report.recommendations.outcomes.ranked_later).toBeGreaterThanOrEqual(1);
    expect(report.recommendations.outcomes.dismissed_not_relevant).toBeGreaterThanOrEqual(1);
    expect(report.recommendations.rankedLaterPositions['0']).toBeGreaterThanOrEqual(1);
    expect(report.recommendations.hoursToWatch.samples).toBeGreaterThanOrEqual(1);
    expect(report.recommendations.hoursToWatch.median).toBeGreaterThanOrEqual(0.9);

    expect(report.model.byModelVersion['e2e-metrics-v1']).toBeGreaterThanOrEqual(1);
    expect(report.model.latestSnapshotByEvidence['5-9']).toBeGreaterThanOrEqual(1);
    expect(report.catalog.titles).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(report.daily)).toBe(true);
    expect(report.daily).toHaveLength(2);
    expect(JSON.stringify(report)).not.toContain('NaN');
  });

  it('leaves excluded domains out of every number', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/metrics?days=2&excludeDomains=metrics-e2e.test,example.com,demo.local,judge.local')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(response.body.recommendations.byBand.strong ?? 0).toBe(0);
    expect(response.body.model.byModelVersion['e2e-metrics-v1']).toBeUndefined();
  });

  it('validates the window', async () => {
    await request(app.getHttpServer()).get('/admin/metrics?days=0').set('Authorization', `Bearer ${adminToken}`).expect(400);
    await request(app.getHttpServer()).get('/admin/metrics?from=not-a-date').set('Authorization', `Bearer ${adminToken}`).expect(400);
  });
});
