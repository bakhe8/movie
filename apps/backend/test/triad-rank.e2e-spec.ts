import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/modules/app/app.module';
import { Title } from '../src/entities/title.entity';

// Exercises the gap-3 rework (ADR-32) over real HTTP against a real Postgres:
// ranking submitted as title ids rather than indices, and Idempotency-Key
// retry safety. idor.e2e-spec.ts deliberately never completes a rank (its
// own scope is auth guards/ownership only), so this is the only place the
// full register -> mark watched -> rank flow runs end to end.
describe('Triad ranking (real HTTP, real DB)', () => {
  let app: INestApplication;
  let titleIds: string[];

  async function registerAndCreateProfile() {
    const email = `rank-check-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const authResponse = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'CorrectHorseBattery1', firstName: 'Rank', lastName: 'Check' })
      .expect(201);
    const token = authResponse.body.access_token as string;

    const profileResponse = await request(app.getHttpServer())
      .post('/profiles')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Rank check ${Date.now()}` })
      .expect(201);

    for (const titleId of titleIds) {
      await request(app.getHttpServer())
        .patch(`/profiles/${profileResponse.body.id}/titles/${titleId}/state`)
        .set('Authorization', `Bearer ${token}`)
        .send({ state: 'watched' })
        .expect(200);
    }

    return { token, profileId: profileResponse.body.id as string };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    const titlesRepository = app.get<Repository<Title>>(getRepositoryToken(Title));
    const suffix = Date.now();
    const titles = await titlesRepository.save([
      { internalId: `E2E-RANK-A-${suffix}`, titleEn: 'Rank Check A', titleAr: 'أ' },
      { internalId: `E2E-RANK-B-${suffix}`, titleEn: 'Rank Check B', titleAr: 'ب' },
      { internalId: `E2E-RANK-C-${suffix}`, titleEn: 'Rank Check C', titleAr: 'ج' },
    ]);
    titleIds = titles.map((title) => title.id);
  }, 20_000);

  afterAll(async () => {
    await app.close();
  });

  it('accepts a title-id ranking, completes the triad, and records answeredAt', async () => {
    const { token, profileId } = await registerAndCreateProfile();

    const current = await request(app.getHttpServer())
      .get(`/profiles/${profileId}/triads/current`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(current.body.status).toBe('active');
    expect(current.body.shownAt).not.toBeNull();
    const [first, second, third] = current.body.titleIds as string[];

    const ranked = await request(app.getHttpServer())
      .post(`/triads/${current.body.id}/rank`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ranking: [third, first, second] })
      .expect(201);

    expect(ranked.body.status).toBe('completed');
    expect(ranked.body.ranking).toEqual([third, first, second]);
    expect(ranked.body.answeredAt).not.toBeNull();
  });

  it('rejects a ranking that uses a title id outside the triad', async () => {
    const { token, profileId } = await registerAndCreateProfile();
    const current = await request(app.getHttpServer())
      .get(`/profiles/${profileId}/triads/current`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const foreignId = '00000000-0000-4000-8000-000000000000';

    await request(app.getHttpServer())
      .post(`/triads/${current.body.id}/rank`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ranking: [foreignId, current.body.titleIds[0], current.body.titleIds[1]] })
      .expect(400);
  });

  it('returns the same result on a retried request with the same Idempotency-Key, not an error', async () => {
    const { token, profileId } = await registerAndCreateProfile();
    const current = await request(app.getHttpServer())
      .get(`/profiles/${profileId}/triads/current`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const ranking = [...(current.body.titleIds as string[])];
    const idempotencyKey = '11111111-2222-4333-8444-555555555555';

    const first = await request(app.getHttpServer())
      .post(`/triads/${current.body.id}/rank`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ ranking })
      .expect(201);

    const retry = await request(app.getHttpServer())
      .post(`/triads/${current.body.id}/rank`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ ranking })
      .expect(201);

    expect(retry.body.id).toBe(first.body.id);
    expect(retry.body.answeredAt).toBe(first.body.answeredAt);
  });
});
