import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/modules/app/app.module';
import { Title } from '../src/entities/title.entity';

async function registerAndCreateProfile(app: INestApplication) {
  const email = `m1-state-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const registerResponse = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: 'CorrectHorseBattery1', firstName: 'M1', lastName: 'State' })
    .expect(201);
  const token = registerResponse.body.access_token as string;

  const profileResponse = await request(app.getHttpServer())
    .post('/profiles')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: `M1 profile ${Date.now()}` })
    .expect(201);

  return { token, profileId: profileResponse.body.id as string };
}

// M1 (an independent audit's finding): PATCH .../titles/:titleId/state used
// to overwrite `notes` unconditionally (`dto.notes ?? null`) even when the
// caller's body omitted the field entirely, and stored a supplied
// `watchedAt` regardless of the target state. Real HTTP round trips against
// real Postgres, not just a unit-level mock, since the bug is specifically
// about what a PATCH does and doesn't touch.
describe('Watch state PATCH semantics (M1)', () => {
  let app: INestApplication;
  let titleId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    const titlesRepository = app.get<Repository<Title>>(getRepositoryToken(Title));
    const suffix = Date.now();
    const title = await titlesRepository.save({
      internalId: `E2E-M1-${suffix}`,
      titleEn: 'M1 Check',
      titleAr: 'فحص',
    });
    titleId = title.id;
  }, 20_000);

  afterAll(async () => {
    await app.close();
  });

  it('does not wipe notes on a PATCH that omits the field', async () => {
    const { token, profileId } = await registerAndCreateProfile(app);

    await request(app.getHttpServer())
      .patch(`/profiles/${profileId}/titles/${titleId}/state`)
      .set('Authorization', `Bearer ${token}`)
      .send({ state: 'watched', notes: 'loved the score' })
      .expect(200);

    const second = await request(app.getHttpServer())
      .patch(`/profiles/${profileId}/titles/${titleId}/state`)
      .set('Authorization', `Bearer ${token}`)
      .send({ state: 'watchlist' })
      .expect(200);

    expect(second.body.notes).toBe('loved the score');
  });

  it('clears notes when the caller explicitly sends null', async () => {
    const { token, profileId } = await registerAndCreateProfile(app);

    await request(app.getHttpServer())
      .patch(`/profiles/${profileId}/titles/${titleId}/state`)
      .set('Authorization', `Bearer ${token}`)
      .send({ state: 'watched', notes: 'temporary note' })
      .expect(200);

    const cleared = await request(app.getHttpServer())
      .patch(`/profiles/${profileId}/titles/${titleId}/state`)
      .set('Authorization', `Bearer ${token}`)
      .send({ state: 'watched', notes: null })
      .expect(200);

    expect(cleared.body.notes).toBeNull();
  });

  it('ignores a supplied watchedAt when the target state is not watched', async () => {
    const { token, profileId } = await registerAndCreateProfile(app);

    const response = await request(app.getHttpServer())
      .patch(`/profiles/${profileId}/titles/${titleId}/state`)
      .set('Authorization', `Bearer ${token}`)
      .send({ state: 'watchlist', watchedAt: '2020-01-01T00:00:00.000Z' })
      .expect(200);

    expect(response.body.watchedAt).toBeNull();
  });
});
