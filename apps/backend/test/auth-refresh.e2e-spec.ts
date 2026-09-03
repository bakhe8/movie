import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/modules/app/app.module';
import { AuditLog } from '../src/entities/audit-log.entity';
import { RefreshToken } from '../src/entities/refresh-token.entity';
import { User } from '../src/entities/user.entity';
import { AuthService, hashRefreshToken } from '../src/modules/auth/auth.service';

const PASSWORD = 'CorrectHorseBattery1';

interface Pair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

// ADR-26 over real HTTP and real Postgres: the pair is issued, rotates,
// detects reuse, ends on logout, and -- the e2e that keeps H2 closed --
// a deactivated account can neither refresh nor use its access token.
describe('Refresh tokens (ADR-26)', () => {
  let app: INestApplication;
  let refreshTokens: Repository<RefreshToken>;
  let users: Repository<User>;
  let audit: Repository<AuditLog>;

  // /auth/register and /auth/login carry a 5/min per-IP throttle
  // (throttling.e2e-spec.ts proves it), so most accounts here are created
  // through AuthService directly and the HTTP door is exercised once.
  async function register(label: string, overHttp = false): Promise<Pair & { user: { id: string; email: string } }> {
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const dto = { email, password: PASSWORD, firstName: 'Refresh', lastName: label };
    if (overHttp) {
      const response = await request(app.getHttpServer()).post('/auth/register').send(dto).expect(201);
      return response.body;
    }
    const result = await app.get(AuthService).register(dto, '127.0.0.1');
    return result as Pair & { user: { id: string; email: string } };
  }

  function whoami(accessToken: string) {
    return request(app.getHttpServer()).get('/auth/profile').set('Authorization', `Bearer ${accessToken}`);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    refreshTokens = app.get<Repository<RefreshToken>>(getRepositoryToken(RefreshToken));
    users = app.get<Repository<User>>(getRepositoryToken(User));
    audit = app.get<Repository<AuditLog>>(getRepositoryToken(AuditLog));
  }, 20_000);

  afterAll(async () => {
    await app.close();
  });

  it('register and login return a pair; only the hash is stored', async () => {
    const pair = await register('issue', true);
    expect(pair).toMatchObject({ token_type: 'Bearer' });
    expect(pair.expires_in).toBeGreaterThan(0);
    expect(pair.refresh_token).toHaveLength(43);
    const rows = await refreshTokens.find({ where: { userId: pair.user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashRefreshToken(pair.refresh_token));
    expect(rows[0].familyId).toBe(rows[0].id);
    expect(rows[0].revokedAt).toBeNull();

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: pair.user.email, password: PASSWORD })
      .expect(201);
    expect(login.body.refresh_token).not.toBe(pair.refresh_token);
    expect(await refreshTokens.count({ where: { userId: pair.user.id } })).toBe(2);
  });

  it('rotates on refresh, then treats the old token as reuse and closes the whole family', async () => {
    const first = await register('rotate');

    const second = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refresh_token: first.refresh_token })
      .expect(200);
    const rotated = second.body as Pair;
    expect(rotated.refresh_token).not.toBe(first.refresh_token);
    await whoami(rotated.access_token).expect(200);

    const old = await refreshTokens.findOne({ where: { tokenHash: hashRefreshToken(first.refresh_token) } });
    const fresh = await refreshTokens.findOne({ where: { tokenHash: hashRefreshToken(rotated.refresh_token) } });
    expect(old?.revokedReason).toBe('rotated');
    expect(old?.replacedById).toBe(fresh?.id);
    expect(fresh?.familyId).toBe(old?.familyId);

    // Replaying the rotated-away token: 401, and the live descendant dies too.
    await request(app.getHttpServer()).post('/auth/refresh').send({ refresh_token: first.refresh_token }).expect(401);
    await request(app.getHttpServer()).post('/auth/refresh').send({ refresh_token: rotated.refresh_token }).expect(401);
    const family = await refreshTokens.find({ where: { familyId: old!.familyId } });
    expect(family.every((row) => row.revokedAt !== null)).toBe(true);
    expect(family.find((row) => row.id === fresh?.id)?.revokedReason).toBe('reuse_detected');
    const audited = await audit.findOne({ where: { action: 'auth.refresh.reuse_detected', actorUserId: first.user.id } });
    expect(audited?.status).toBe('failed');
  });

  it('refuses garbage, an expired token, and validates the body', async () => {
    await request(app.getHttpServer()).post('/auth/refresh').send({ refresh_token: 'short' }).expect(400);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refresh_token: 'definitely-not-a-token-we-issued-xxxx' })
      .expect(401);

    const pair = await register('expire');
    await refreshTokens.update({ tokenHash: hashRefreshToken(pair.refresh_token) }, { expiresAt: new Date(Date.now() - 1000) });
    await request(app.getHttpServer()).post('/auth/refresh').send({ refresh_token: pair.refresh_token }).expect(401);
  });

  it('logout ends one session; logout all ends every session of the account', async () => {
    const a = await register('logout');
    const b = (
      await request(app.getHttpServer()).post('/auth/login').send({ email: a.user.email, password: PASSWORD }).expect(201)
    ).body as Pair;

    const one = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${a.access_token}`)
      .send({ refresh_token: a.refresh_token })
      .expect(200);
    expect(one.body).toEqual({ revoked: 1 });
    await request(app.getHttpServer()).post('/auth/refresh').send({ refresh_token: a.refresh_token }).expect(401);
    // The other session is untouched.
    await request(app.getHttpServer()).post('/auth/refresh').send({ refresh_token: b.refresh_token }).expect(200);

    const all = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${b.access_token}`)
      .send({ all: true })
      .expect(200);
    expect(all.body.revoked).toBeGreaterThanOrEqual(1);
    expect(await refreshTokens.count({ where: { userId: a.user.id, revokedAt: undefined } })).toBeGreaterThan(0);
    const live = (await refreshTokens.find({ where: { userId: a.user.id } })).filter((row) => row.revokedAt === null);
    expect(live).toHaveLength(0);

    await request(app.getHttpServer()).post('/auth/logout').send({ all: true }).expect(401);
  });

  it('a deactivated account can neither refresh nor use its access token (H2 stays closed)', async () => {
    const pair = await register('deactivate');
    await whoami(pair.access_token).expect(200);

    await users.update({ id: pair.user.id }, { active: false });

    await request(app.getHttpServer()).post('/auth/refresh').send({ refresh_token: pair.refresh_token }).expect(401);
    await whoami(pair.access_token).expect(401);
    const rows = await refreshTokens.find({ where: { userId: pair.user.id } });
    expect(rows.every((row) => row.revokedReason === 'deactivated')).toBe(true);
    await request(app.getHttpServer()).post('/auth/login').send({ email: pair.user.email, password: PASSWORD }).expect(401);
  });

  it('a purged account takes its sessions with it', async () => {
    const pair = await register('purge');
    expect(await refreshTokens.count({ where: { userId: pair.user.id } })).toBe(1);
    await users.delete({ id: pair.user.id });
    expect(await refreshTokens.count({ where: { userId: pair.user.id } })).toBe(0);
    await request(app.getHttpServer()).post('/auth/refresh').send({ refresh_token: pair.refresh_token }).expect(401);
  });
});
