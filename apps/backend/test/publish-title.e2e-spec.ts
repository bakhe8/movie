import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/modules/app/app.module';
import { AuditLog } from '../src/entities/audit-log.entity';
import { Title } from '../src/entities/title.entity';
import { TitleRevision } from '../src/entities/title-revision.entity';
import { User } from '../src/entities/user.entity';
import { AuthService } from '../src/modules/auth/auth.service';

const PASSWORD = 'CorrectHorseBattery1';

// Board 1D-9: manual publish's transaction contract, tested ONLY against
// moviedb_test (STRICT rule from the coordinator/owner -- this must never
// run against the shared dev database until explicit separate permission
// is given, regardless of how clean it looks here).
describe('Manual publish (board 1D-9, admin-only, transactional)', () => {
  let app: INestApplication;
  let adminToken: string;
  let userToken: string;
  let titles: Repository<Title>;
  let revisions: Repository<TitleRevision>;
  let audit: Repository<AuditLog>;
  let suffix: string;

  // Distinct titleEn per row on purpose: `GET /titles` orders by titleEn, and
  // rows sharing one value make that order (and any pagination assertion
  // built on it, e.g. api-contract.e2e-spec.ts) non-deterministic.
  async function makeReadyTitle(internalSuffix: string) {
    return titles.save({
      internalId: `0-E2E-PUBLISH-${suffix}-${internalSuffix}`,
      titleEn: `Ready For Publish ${suffix} ${internalSuffix}`,
      titleAr: `جاهز للنشر ${internalSuffix}`,
      description: 'A complete description.',
      genres: ['drama'],
      posterPath: '/ready.jpg',
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    const users = app.get<Repository<User>>(getRepositoryToken(User));
    titles = app.get<Repository<Title>>(getRepositoryToken(Title));
    revisions = app.get<Repository<TitleRevision>>(getRepositoryToken(TitleRevision));
    audit = app.get<Repository<AuditLog>>(getRepositoryToken(AuditLog));

    const auth = app.get(AuthService);
    suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const adminAccount = await auth.register({ email: `publish-admin-${suffix}@example.com`, password: PASSWORD, firstName: 'Ada', lastName: 'Admin' });
    await users.update({ id: adminAccount.user.id as string }, { role: 'admin' });
    adminToken = (await auth.login({ email: `publish-admin-${suffix}@example.com`, password: PASSWORD })).access_token;

    const plain = await auth.register({ email: `publish-plain-${suffix}@example.com`, password: PASSWORD, firstName: 'Pat', lastName: 'Plain' });
    userToken = plain.access_token;
  }, 20_000);

  afterAll(async () => {
    await app.close();
  });

  it('is closed to anonymous callers (401) and to signed-in non-admins (403)', async () => {
    const title = await makeReadyTitle('auth');
    await request(app.getHttpServer()).post(`/admin/publication/titles/${title.id}/publish`).expect(401);
    await request(app.getHttpServer())
      .post(`/admin/publication/titles/${title.id}/publish`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('publishes a ready, never-published title: creates a revision, sets the pointer, and audits it', async () => {
    const title = await makeReadyTitle('happy');

    const response = await request(app.getHttpServer())
      .post(`/admin/publication/titles/${title.id}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(201);

    expect(response.body).toMatchObject({ titleId: title.id, policyVersion: 'public-v1' });
    expect(typeof response.body.publishedRevisionId).toBe('string');

    const reloaded = await titles.findOneOrFail({ where: { id: title.id } });
    expect(reloaded.publishedRevisionId).toBe(response.body.publishedRevisionId);

    const revision = await revisions.findOneOrFail({ where: { id: response.body.publishedRevisionId } });
    expect(revision).toMatchObject({ titleId: title.id, titleEn: title.titleEn, policyVersion: 'public-v1', blockerCodes: [] });

    const auditRow = await audit.findOne({ where: { action: 'publication.publish', resourceId: title.id }, order: { createdAt: 'DESC' } });
    expect(auditRow).toMatchObject({ status: 'ok', actorRole: 'admin' });
  });

  it('refuses (409, not_ready) a title that fails public-v1, and writes nothing', async () => {
    const title = await titles.save({
      internalId: `0-E2E-PUBLISH-${suffix}-notready`,
      titleEn: `Incomplete ${suffix}`,
      titleAr: `ناقص ${suffix}`,
      description: null as unknown as string,
      genres: null as unknown as string[],
      posterPath: null,
    });

    const response = await request(app.getHttpServer())
      .post(`/admin/publication/titles/${title.id}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(409);

    expect(response.body).toMatchObject({ reason: 'not_ready' });
    expect(response.body.blockerCodes).toEqual(
      expect.arrayContaining(['POSTER_MISSING', 'DESCRIPTION_MISSING', 'GENRES_MISSING']),
    );

    const reloaded = await titles.findOneOrFail({ where: { id: title.id } });
    expect(reloaded.publishedRevisionId).toBeNull();
  });

  it('refuses (409, revision_mismatch) when expectedRevision does not match the current pointer', async () => {
    const title = await makeReadyTitle('mismatch');

    const response = await request(app.getHttpServer())
      .post(`/admin/publication/titles/${title.id}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ expectedRevision: '00000000-0000-0000-0000-000000000000' })
      .expect(409);

    expect(response.body).toMatchObject({ reason: 'revision_mismatch', expectedRevision: '00000000-0000-0000-0000-000000000000', actualRevision: null });
  });

  it('allows a correct republish once expectedRevision matches the currently published revision', async () => {
    const title = await makeReadyTitle('republish');

    const first = await request(app.getHttpServer())
      .post(`/admin/publication/titles/${title.id}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(201);

    const second = await request(app.getHttpServer())
      .post(`/admin/publication/titles/${title.id}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ expectedRevision: first.body.publishedRevisionId })
      .expect(201);

    expect(second.body.publishedRevisionId).not.toBe(first.body.publishedRevisionId);
    const reloaded = await titles.findOneOrFail({ where: { id: title.id } });
    expect(reloaded.publishedRevisionId).toBe(second.body.publishedRevisionId);

    // The old revision row is never deleted or overwritten (BP §11.3 discipline).
    const oldRevision = await revisions.findOneOrFail({ where: { id: first.body.publishedRevisionId } });
    expect(oldRevision.id).toBe(first.body.publishedRevisionId);
  });

  // The policy is re-run against the row's current state inside the publish
  // transaction -- "it passed last time" is never carried forward.
  it('re-evaluates at publish time: a previously published title that has since lost a required field is refused', async () => {
    const title = await makeReadyTitle('reeval');

    const first = await request(app.getHttpServer())
      .post(`/admin/publication/titles/${title.id}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(201);

    await titles.update({ id: title.id }, { posterPath: null });

    const republish = await request(app.getHttpServer())
      .post(`/admin/publication/titles/${title.id}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ expectedRevision: first.body.publishedRevisionId })
      .expect(409);

    expect(republish.body).toMatchObject({ reason: 'not_ready' });
    expect(republish.body.blockerCodes).toContain('POSTER_MISSING');

    // The already-published pointer is left exactly as it was: a refused
    // republish never unpublishes what is already live.
    const reloaded = await titles.findOneOrFail({ where: { id: title.id } });
    expect(reloaded.publishedRevisionId).toBe(first.body.publishedRevisionId);
  });

  // The row lock's whole purpose: two concurrent first-publish attempts on
  // the same title must never both win.
  it('serializes concurrent publish attempts on the same title: exactly one wins, the rest get revision_mismatch', async () => {
    const title = await makeReadyTitle('race');

    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        request(app.getHttpServer()).post(`/admin/publication/titles/${title.id}/publish`).set('Authorization', `Bearer ${adminToken}`).send({}),
      ),
    );

    const statuses = attempts.map((outcome) => (outcome.status === 'fulfilled' ? outcome.value.status : -1));
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(4);

    const revisionRows = await revisions.find({ where: { titleId: title.id } });
    expect(revisionRows).toHaveLength(1);

    const reloaded = await titles.findOneOrFail({ where: { id: title.id } });
    expect(reloaded.publishedRevisionId).toBe(revisionRows[0].id);
  });
});
