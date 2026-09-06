import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/modules/app/app.module';
import { User } from '../src/entities/user.entity';
import { AuthService } from '../src/modules/auth/auth.service';

const PASSWORD = 'CorrectHorseBattery1';

// ADMIN-W6 (plan §17.3/§18 W6): the settings center's HTTP surface --
// resolution order (control-plane row > env var > hardcoded default),
// validation, optimistic-concurrency, and rollback restoring an old value
// as a new version rather than rewriting history.
//
// catalog.min_titles/catalog.min_fingerprint_coverage are fixed, global
// keys (unlike a title or job row, there is no per-test-run suffix to keep
// two runs apart), so every version number here is relative to whatever the
// key's current version already is when this file starts -- never a
// hardcoded absolute like "version 1" -- so the suite tolerates running
// more than once against the same moviedb_test without a reset in between.
describe('Admin settings API (role-gated)', () => {
  let app: INestApplication;
  let adminToken: string;
  let users: Repository<User>;

  const admin = () => (path: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${adminToken}`);

  async function currentVersion(key: string): Promise<number> {
    const detail = await admin()(`/admin/settings/${key}`).expect(200);
    return detail.body.setting.version;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    users = app.get<Repository<User>>(getRepositoryToken(User));
    const auth = app.get(AuthService);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const adminAccount = await auth.register({ email: `admin-settings-${suffix}@example.com`, password: PASSWORD, firstName: 'Ada', lastName: 'Admin' });
    await users.update({ id: adminAccount.user.id as string }, { role: 'admin' });
    adminToken = (await auth.login({ email: `admin-settings-${suffix}@example.com`, password: PASSWORD })).access_token;
  }, 20_000);

  afterAll(async () => {
    await app.close();
  });

  it('is closed to anonymous callers', async () => {
    await request(app.getHttpServer()).get('/admin/settings').expect(401);
  });

  it('lists registered settings with a real value regardless of whether one was ever published', async () => {
    const list = await admin()('/admin/settings').expect(200);
    const setting = list.body.find((s: { key: string }) => s.key === 'catalog.min_fingerprint_coverage');
    expect(setting).toBeTruthy();
    expect(typeof setting.value).toBe('number');
    expect(['default', 'deploy', 'control_plane']).toContain(setting.source);
  });

  it('previews an invalid value without writing anything', async () => {
    const before = await currentVersion('catalog.min_fingerprint_coverage');
    const preview = await request(app.getHttpServer())
      .post('/admin/settings/catalog.min_fingerprint_coverage/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: 5 })
      .expect(201);
    expect(preview.body).toMatchObject({ valid: false, proposed: 5 });
    expect(await currentVersion('catalog.min_fingerprint_coverage')).toBe(before);
  });

  it('refuses an invalid value on publish, and the whole round trip works for a valid one', async () => {
    const before = await currentVersion('catalog.min_fingerprint_coverage');
    await request(app.getHttpServer())
      .patch('/admin/settings/catalog.min_fingerprint_coverage')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: 2, reason: 'test: too high' })
      .expect(400);
    expect(await currentVersion('catalog.min_fingerprint_coverage')).toBe(before);

    const published = await request(app.getHttpServer())
      .patch('/admin/settings/catalog.min_fingerprint_coverage')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: 0.6, reason: 'رفع الحد الأدنى موسمياً' })
      .expect(200);
    expect(published.body).toMatchObject({ value: 0.6, version: before + 1, source: 'control_plane' });

    const detail = await admin()('/admin/settings/catalog.min_fingerprint_coverage').expect(200);
    expect(detail.body.setting).toMatchObject({ value: 0.6, version: before + 1 });
    expect(detail.body.history[0]).toMatchObject({ value: 0.6, version: before + 1, reason: expect.stringContaining('رفع الحد') });
  });

  it('refuses a stale expectedVersion with a 409 naming the real current state', async () => {
    const before = await currentVersion('catalog.min_titles');
    await request(app.getHttpServer())
      .patch('/admin/settings/catalog.min_titles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: 250, reason: 'v-next', expectedVersion: before })
      .expect(200);

    const conflict = await request(app.getHttpServer())
      .patch('/admin/settings/catalog.min_titles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: 300, reason: 'stale attempt', expectedVersion: before })
      .expect(409);
    expect(conflict.body).toMatchObject({ reason: 'version_conflict', currentVersion: before + 1, currentValue: 250 });
  });

  it('rolls back to an old version as a new one, keeping full history', async () => {
    const key = 'catalog.min_titles';
    const goodVersion = await currentVersion(key); // value 250, from the previous test

    await request(app.getHttpServer())
      .patch(`/admin/settings/${key}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: 999, reason: 'a mistake' })
      .expect(200);

    const rolledBack = await request(app.getHttpServer())
      .post(`/admin/settings/${key}/rollback`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ toVersion: goodVersion })
      .expect(201);
    expect(rolledBack.body).toMatchObject({ value: 250, version: goodVersion + 2 });

    const detail = await admin()(`/admin/settings/${key}`).expect(200);
    expect(detail.body.history.slice(0, 2).map((v: { version: number; value: number }) => [v.version, v.value])).toEqual([
      [goodVersion + 2, 250],
      [goodVersion + 1, 999],
    ]);
  });

  it('404s rolling back to a version that never existed', async () => {
    await request(app.getHttpServer())
      .post('/admin/settings/catalog.min_titles/rollback')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ toVersion: 999_999 })
      .expect(404);
  });

  it('404s for an unregistered setting key', async () => {
    await admin()('/admin/settings/not.a.real.setting').expect(404);
  });

  // ADMIN-W6's whole point: a published value affects the very next
  // readiness() call, no restart. catalog.min_titles is the one of the two
  // readiness thresholds the response actually echoes back (`catalog.
  // threshold`), so this is a real assertion, not a tautology against the
  // response's own computed `ok`.
  it('a published catalog.min_titles takes effect on the next readiness read, no restart', async () => {
    await request(app.getHttpServer())
      .patch('/admin/settings/catalog.min_titles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: 12_345, reason: 'e2e wiring check' })
      .expect(200);
    const readiness = await admin()('/admin/readiness').expect(200);
    expect(readiness.body.catalog.threshold).toBe(12_345);
  });
});
