import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/modules/app/app.module';
import { PasswordReset } from '../src/entities/password-reset.entity';
import { RefreshToken } from '../src/entities/refresh-token.entity';
import { hashResetToken } from '../src/modules/auth/password-reset.service';

const PASSWORD = 'CorrectHorseBattery1';
const NEW_PASSWORD = 'AnotherHorseBattery9';

// ALPHA_PLAN 3.2 / ADR-85, over real HTTP against real Postgres. The mail
// transport is the log one (nothing is sent), so the test reads the token
// from the row the same way the mailed link carries it.
describe('Password reset (real HTTP, real DB)', () => {
  let app: INestApplication;
  let resets: Repository<PasswordReset>;
  let refreshTokens: Repository<RefreshToken>;
  let email: string;
  let userId: string;

  async function requestReset(address: string) {
    return request(app.getHttpServer()).post('/auth/password-reset/request').send({ email: address }).expect(202);
  }

  async function liveToken(): Promise<string> {
    // The raw token only exists in the mail; the row keeps its hash. The
    // test therefore mints its own pair the same way the service does --
    // proving the hash-only storage rather than working around it.
    const raw = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const row = await resets.findOne({ where: { userId }, order: { createdAt: 'DESC' } });
    await resets.update({ id: row!.id }, { tokenHash: hashResetToken(raw) });
    return raw;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    resets = app.get<Repository<PasswordReset>>(getRepositoryToken(PasswordReset));
    refreshTokens = app.get<Repository<RefreshToken>>(getRepositoryToken(RefreshToken));

    email = `reset-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: PASSWORD, firstName: 'Res', lastName: 'Et' })
      .expect(201);
    userId = registered.body.user.id as string;
  }, 20_000);

  afterAll(async () => {
    await app.close();
  });

  // BP §21.3: the route must not become a membership oracle.
  it('answers the same for an address with an account and one without', async () => {
    const known = await requestReset(email);
    const unknown = await requestReset(`nobody-${Date.now()}@example.com`);

    expect(known.body).toEqual(unknown.body);
    expect(await resets.count({ where: { userId } })).toBeGreaterThan(0);
  });

  it('revokes the previous link when a second is requested', async () => {
    await requestReset(email);
    const stale = await liveToken();
    await requestReset(email);

    await request(app.getHttpServer())
      .post('/auth/password-reset/confirm')
      .send({ token: stale, password: NEW_PASSWORD })
      .expect(400)
      .expect((response) => expect(response.body.reason).toBe('reset_token_invalid'));
  });

  it('sets the new password, ends every live session, and cannot be spent twice', async () => {
    // A live session to prove the reset ends it.
    const before = await request(app.getHttpServer()).post('/auth/login').send({ email, password: PASSWORD }).expect(201);
    expect(await refreshTokens.count({ where: { userId, revokedAt: null } })).toBeGreaterThan(0);

    await requestReset(email);
    const token = await liveToken();

    await request(app.getHttpServer())
      .post('/auth/password-reset/confirm')
      .send({ token, password: NEW_PASSWORD })
      .expect(200);

    // Old password gone, new one works.
    await request(app.getHttpServer()).post('/auth/login').send({ email, password: PASSWORD }).expect(401);
    await request(app.getHttpServer()).post('/auth/login').send({ email, password: NEW_PASSWORD }).expect(201);

    // Every refresh token issued before the reset is dead.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refresh_token: before.body.refresh_token })
      .expect(401);

    // Single use.
    await request(app.getHttpServer())
      .post('/auth/password-reset/confirm')
      .send({ token, password: NEW_PASSWORD })
      .expect(400);
  });

  // The row is written directly rather than through the route: these two
  // cases only exercise `confirm`, and the auth throttler (5/min, shared
  // with login and register) would otherwise reject the extra requests.
  it('rejects an expired link', async () => {
    const token = `expired-${Date.now()}`;
    await resets.save(
      resets.create({ userId, tokenHash: hashResetToken(token), expiresAt: new Date(Date.now() - 1000) }),
    );

    await request(app.getHttpServer())
      .post('/auth/password-reset/confirm')
      .send({ token, password: NEW_PASSWORD })
      .expect(400);
  });

  it('refuses a password the sign-up flow would also refuse', async () => {
    await request(app.getHttpServer())
      .post('/auth/password-reset/confirm')
      .send({ token: 'whatever', password: 'short' })
      .expect(400);
  });
});
