import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/modules/app/app.module';
import { AnalyticsEvent } from '../src/entities/analytics-event.entity';

// ALPHA_PLAN 7.5 over real HTTP against real Postgres. The privacy-critical
// half is the consent gate: analytics_first_party is opt-in (PRIVACY.md §3),
// so a profile that has not granted it must leave no trace in the table.
describe('Analytics events (real HTTP, real DB)', () => {
  let app: INestApplication;
  let events: Repository<AnalyticsEvent>;
  let token: string;
  let profileId: string;

  const post = (body: Record<string, unknown>, id = profileId) =>
    request(app.getHttpServer())
      .post(`/profiles/${id}/analytics/events`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const mine = () => events.find({ where: { profileId } });

  async function consent(granted: boolean) {
    await request(app.getHttpServer())
      .put('/consents')
      .set('Authorization', `Bearer ${token}`)
      .send({ consents: [{ purpose: 'analytics_first_party', version: '2026-09-04', granted }] })
      .expect(200);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    events = app.get<Repository<AnalyticsEvent>>(getRepositoryToken(AnalyticsEvent));

    const email = `analytics-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'CorrectHorseBattery1', firstName: 'Ana', lastName: 'Lytics' })
      .expect(201);
    token = registered.body.access_token as string;
    const profile = await request(app.getHttpServer())
      .post('/profiles')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Analytics' })
      .expect(201);
    profileId = profile.body.id as string;
  }, 20_000);

  afterAll(async () => {
    await app.close();
  });

  it('writes nothing before the analytics purpose is granted, and still answers 202', async () => {
    await post({ name: 'onboarding_started' }).expect(202);

    expect(await mine()).toHaveLength(0);
  });

  it('records once the purpose is granted', async () => {
    await consent(true);

    await post({ name: 'onboarding_completed', properties: { stepsSeen: 4 } }).expect(202);

    const rows = await mine();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'onboarding_completed', properties: { stepsSeen: 4 } });
  });

  it('stops recording again the moment the purpose is revoked', async () => {
    await consent(false);

    await post({ name: 'onboarding_started' }).expect(202);

    expect(await mine()).toHaveLength(1); // still just the one from before
  });

  it('refuses an event name that is not on the closed list', async () => {
    await post({ name: 'password_typed' }).expect(400);
  });

  it('strips a property that is not a number, a short tag or a boolean', async () => {
    await consent(true);

    await post({
      name: 'recommendation_opened',
      properties: { position: 3, note: 'x'.repeat(40), who: { email: 'a@b.c' } },
    }).expect(202);

    const opened = (await mine()).find((row) => row.name === 'recommendation_opened');
    expect(opened?.properties).toEqual({ position: 3 });
  });

  // 202 either way: a different answer for a profile that is not yours would
  // say whether it exists.
  it('writes nothing for a profile belonging to someone else, without saying so', async () => {
    const other = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `analytics-other-${Date.now()}@example.com`,
        password: 'CorrectHorseBattery1',
        firstName: 'Oth',
        lastName: 'Er',
      })
      .expect(201);
    const otherProfile = await request(app.getHttpServer())
      .post('/profiles')
      .set('Authorization', `Bearer ${other.body.access_token}`)
      .send({ name: 'Other' })
      .expect(201);

    const before = await events.count({ where: { profileId: otherProfile.body.id as string } });
    await post({ name: 'onboarding_started' }, otherProfile.body.id as string).expect(202);

    expect(await events.count({ where: { profileId: otherProfile.body.id as string } })).toBe(before);
  });
});
