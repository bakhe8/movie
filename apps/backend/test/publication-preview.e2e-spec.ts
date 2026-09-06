import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/modules/app/app.module';
import { SourceRecord } from '../src/entities/source-record.entity';
import { Title } from '../src/entities/title.entity';
import { User } from '../src/entities/user.entity';
import { AuthService } from '../src/modules/auth/auth.service';

const PASSWORD = 'CorrectHorseBattery1';

// PUB-S1 (ADR-118): the admin-only, read-only public-v1 shadow report --
// same role gate as every other /admin route, and asserts the response
// never carries a publishedRevisionId write side effect (there is none to
// write yet: this route only reads titles/source_records).
describe('Publication readiness preview (public-v1 shadow, read-only)', () => {
  let app: INestApplication;
  let adminToken: string;
  let userToken: string;
  let readyTitleId: string;
  let blockedTitleId: string;
  let expiredTitleId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    const users = app.get<Repository<User>>(getRepositoryToken(User));
    const titles = app.get<Repository<Title>>(getRepositoryToken(Title));
    const sourceRecords = app.get<Repository<SourceRecord>>(getRepositoryToken(SourceRecord));

    const auth = app.get(AuthService);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const adminAccount = await auth.register({ email: `pub-admin-${suffix}@example.com`, password: PASSWORD, firstName: 'Ada', lastName: 'Admin' });
    await users.update({ id: adminAccount.user.id as string }, { role: 'admin' });
    adminToken = (await auth.login({ email: `pub-admin-${suffix}@example.com`, password: PASSWORD })).access_token;

    const plain = await auth.register({ email: `pub-plain-${suffix}@example.com`, password: PASSWORD, firstName: 'Pat', lastName: 'Plain' });
    userToken = plain.access_token;

    const ready = await titles.save({
      internalId: `0-E2E-PUB-READY-${suffix}`,
      titleEn: 'Ready Film',
      titleAr: 'فيلم جاهز',
      description: 'A complete description.',
      genres: ['drama'],
      posterPath: '/ready.jpg',
    });
    readyTitleId = ready.id;

    const blocked = await titles.save({
      internalId: `0-E2E-PUB-BLOCKED-${suffix}`,
      titleEn: 'Incomplete Film',
      titleAr: 'فيلم ناقص',
      description: null as unknown as string,
      genres: null as unknown as string[],
      posterPath: null,
    });
    blockedTitleId = blocked.id;

    const expired = await titles.save({
      internalId: `0-E2E-PUB-EXPIRED-${suffix}`,
      titleEn: 'Expired Rights Film',
      titleAr: 'فيلم منتهي الحقوق',
      description: 'A complete description.',
      genres: ['drama'],
      posterPath: '/expired.jpg',
    });
    expiredTitleId = expired.id;
    await sourceRecords.save(
      sourceRecords.create({
        titleId: expiredTitleId,
        fieldName: 'posterPath',
        source: 'tmdb',
        licenseStatus: 'unknown',
        retentionUntil: new Date(Date.now() - 1000),
      }),
    );
  }, 20_000);

  afterAll(async () => {
    await app.close();
  });

  it('is closed to anonymous callers (401) and to signed-in non-admins (403)', async () => {
    await request(app.getHttpServer()).get('/admin/publication/readiness').expect(401);
    await request(app.getHttpServer())
      .get('/admin/publication/readiness')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('reports public-v1 blockerCodes per title without writing anything (shadow mode)', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/publication/readiness')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.policyVersion).toBe('public-v1');
    expect(response.body.totalTitles).toBeGreaterThanOrEqual(3);

    const byId = new Map(response.body.titles.map((row: { titleId: string }) => [row.titleId, row]));
    expect(byId.get(readyTitleId)).toMatchObject({ blockerCodes: [], ready: true });
    expect(byId.get(blockedTitleId)).toMatchObject({
      blockerCodes: expect.arrayContaining(['POSTER_MISSING', 'DESCRIPTION_MISSING', 'GENRES_MISSING']),
      ready: false,
    });
    expect(byId.get(expiredTitleId)).toMatchObject({ blockerCodes: ['LICENSE_BLOCKED'], ready: false });
  });
});
