import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/modules/app/app.module';
import { AuditLog } from '../src/entities/audit-log.entity';
import { ContentFeature } from '../src/entities/content-feature.entity';
import { ModelVersion } from '../src/entities/model-version.entity';
import { Profile } from '../src/entities/profile.entity';
import { RefreshToken } from '../src/entities/refresh-token.entity';
import { Title } from '../src/entities/title.entity';
import { User } from '../src/entities/user.entity';
import { UserModelSnapshot } from '../src/entities/user-model-snapshot.entity';
import { AuthService } from '../src/modules/auth/auth.service';
import { ADMIN_CAPABILITIES } from '../src/modules/admin/admin-capabilities';
import { HUMAN_REVIEW_EXTRACTOR } from '../src/modules/admin/admin-catalog.service';

const PASSWORD = 'CorrectHorseBattery1';

// The internal board's API over real HTTP and real Postgres (BP §5.1,
// SPECIFICATION §5.5): role gate, catalog edits and rights rows, the
// fingerprint review queue with superseding corrections, model activation
// exclusivity, account deactivation, and the audit trail every write leaves.
describe('Admin board API (role-gated)', () => {
  let app: INestApplication;
  let adminToken: string;
  let adminId: string;
  let userToken: string;
  let userId: string;
  let titleId: string;
  let users: Repository<User>;
  let audit: Repository<AuditLog>;
  let features: Repository<ContentFeature>;
  let models: Repository<ModelVersion>;
  let refreshTokens: Repository<RefreshToken>;
  let profiles: Repository<Profile>;
  let snapshots: Repository<UserModelSnapshot>;

  const admin = () => (path: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${adminToken}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    users = app.get<Repository<User>>(getRepositoryToken(User));
    audit = app.get<Repository<AuditLog>>(getRepositoryToken(AuditLog));
    features = app.get<Repository<ContentFeature>>(getRepositoryToken(ContentFeature));
    models = app.get<Repository<ModelVersion>>(getRepositoryToken(ModelVersion));
    refreshTokens = app.get<Repository<RefreshToken>>(getRepositoryToken(RefreshToken));
    profiles = app.get<Repository<Profile>>(getRepositoryToken(Profile));
    snapshots = app.get<Repository<UserModelSnapshot>>(getRepositoryToken(UserModelSnapshot));

    const auth = app.get(AuthService);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const adminAccount = await auth.register({ email: `admin-${suffix}@example.com`, password: PASSWORD, firstName: 'Ada', lastName: 'Admin' });
    adminId = adminAccount.user.id as string;
    // The role is granted outside HTTP (grant-admin script / another admin);
    // here straight in the table, then a fresh login so the token is plain.
    await users.update({ id: adminId }, { role: 'admin' });
    adminToken = (await auth.login({ email: `admin-${suffix}@example.com`, password: PASSWORD })).access_token;

    const plain = await auth.register({ email: `plain-${suffix}@example.com`, password: PASSWORD, firstName: 'Pat', lastName: 'Plain' });
    userId = plain.user.id as string;
    userToken = plain.access_token;

    const titles = app.get<Repository<Title>>(getRepositoryToken(Title));
    // "0-" sorts before every catalog internalId ("DEMO...") under the
    // missing-fingerprints endpoint's `ORDER BY internalId ASC` -- so this
    // row is always on page 1 regardless of how large the catalog grows,
    // instead of depending on `limit` outrunning the catalog's own count.
    const title = await titles.save({
      internalId: `0-E2E-ADMIN-${suffix}`,
      titleEn: 'Admin Check',
      titleAr: 'فحص الإدارة',
      fingerprint: { schemaVersion: 'film-fingerprint-v1', pacing: 0.5 } as never,
    });
    titleId = title.id;
    await features.save(
      features.create({
        titleId,
        featureKey: 'pacing',
        value: 0.5,
        uncertainty: 0.4,
        sourceIds: [],
        extractorVersion: 'e2e-extractor-v1',
        licenseStatus: 'unknown',
        reviewStatus: 'unreviewed',
        validFrom: new Date(),
      }),
    );
  }, 20_000);

  afterAll(async () => {
    await app.close();
  });

  it('is closed to anonymous callers (401) and to signed-in non-admins (403 with a reason)', async () => {
    await request(app.getHttpServer()).get('/admin/titles').expect(401);
    const forbidden = await request(app.getHttpServer()).get('/admin/titles').set('Authorization', `Bearer ${userToken}`).expect(403);
    expect(forbidden.body).toMatchObject({ reason: 'admin_required' });
    await request(app.getHttpServer()).get('/admin/users').set('Authorization', `Bearer ${userToken}`).expect(403);
  });

  // ADMIN-W1 (ADR-117): the access-boundary probe the frontend gates on
  // instead of a throwaway `titles?limit=1` read. Same guard order as every
  // other admin route -- 401 anonymous, 403 non-admin, capabilities only for
  // a real admin.
  it('reports admin context and capabilities distinctly from a plain 403', async () => {
    await request(app.getHttpServer()).get('/admin/context').expect(401);
    const forbidden = await request(app.getHttpServer()).get('/admin/context').set('Authorization', `Bearer ${userToken}`).expect(403);
    expect(forbidden.body).toMatchObject({ reason: 'admin_required' });

    const context = await admin()('/admin/context').expect(200);
    expect(context.body).toMatchObject({ user: { id: adminId, role: 'admin' } });
    expect(context.body.capabilities.sort()).toEqual([...ADMIN_CAPABILITIES].sort());
  });

  it('lists the catalog with fingerprint/license summaries and the missing-fingerprints view', async () => {
    const list = await admin()(`/admin/titles?query=E2E-ADMIN&limit=10`).expect(200);
    const row = list.body.items.find((item: { id: string }) => item.id === titleId);
    expect(row).toMatchObject({ hasFingerprint: true, hasV2: false, licenseStatus: 'unknown', sourceRecords: 0, unreviewedFeatures: 1 });

    const missing = await admin()(`/admin/titles/missing-fingerprints?limit=200`).expect(200);
    expect(missing.body.items.some((item: { id: string }) => item.id === titleId)).toBe(true);
    const missingLicense = await admin()(`/admin/titles?missing=license&limit=200`).expect(200);
    expect(missingLicense.body.items.some((item: { id: string }) => item.id === titleId)).toBe(true);
  });

  it('edits source data, adds a rights row, and audits both', async () => {
    // A fresh id per run, not a literal: CAT-1's identity guard rejects two
    // titles claiming the same wikidata id (UQ_titles_wikidata_identity), and
    // a literal here collided with a still-unreconciled row from an earlier
    // local run against this shared moviedb_test database. The format itself
    // is also enforced (CHK_titles_wikidata_identity: `^Q[1-9][0-9]*$`), so
    // the id has to look like a real QID, not just be unique.
    const wikidataId = `Q${Date.now()}`;
    const edited = await request(app.getHttpServer())
      .patch(`/admin/titles/${titleId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ releaseYear: 1999, genres: ['Drama'], externalIds: { wikidata: wikidataId } })
      .expect(200);
    expect(edited.body).toMatchObject({ releaseYear: 1999, genres: ['Drama'], externalIds: { wikidata: wikidataId } });
    await request(app.getHttpServer())
      .patch(`/admin/titles/${titleId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fingerprint: { pacing: 1 } })
      .expect(400);

    const record = await request(app.getHttpServer())
      .post(`/admin/titles/${titleId}/source-records`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fieldName: 'description', source: 'wikipedia', license: 'CC BY-SA 4.0', licenseStatus: 'commercial_allowed', attributionRequired: true })
      .expect(201);
    expect(record.body).toMatchObject({ titleId, licenseStatus: 'commercial_allowed', reviewStatus: 'human_verified' });

    // ADMIN-W4 (ADM-P0-04): a source-record edit now supersedes rather than
    // overwrites, matching the entity's own "never edited in place" contract
    // -- the response is a NEW row, and the original is left in place with
    // supersededBy pointing at it.
    const updated = await request(app.getHttpServer())
      .patch(`/admin/source-records/${record.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ licenseStatus: 'non_commercial_only' })
      .expect(200);
    expect(updated.body.licenseStatus).toBe('non_commercial_only');
    expect(updated.body.id).not.toBe(record.body.id);

    // Editing the now-superseded original is rejected, not forked again.
    await request(app.getHttpServer())
      .patch(`/admin/source-records/${record.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ licenseStatus: 'commercial_allowed' })
      .expect(409);

    const provenance = await admin()(`/admin/titles/${titleId}/provenance`).expect(200);
    expect(provenance.body.licenseStatus).toBe('non_commercial_only');
    expect(provenance.body.sourceRecords).toHaveLength(2);
    const original = provenance.body.sourceRecords.find((row: { id: string }) => row.id === record.body.id);
    expect(original.supersededBy).toBe(updated.body.id);
    expect(provenance.body.byExtractor['e2e-extractor-v1']).toMatchObject({ rows: 1, unreviewed: 1 });

    const actions = (await audit.find({ where: { actorUserId: adminId } })).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(['admin.title.update', 'admin.source_record.create', 'admin.source_record.update']));
  });

  it('serves the review queue and a sample; a correction supersedes rather than edits', async () => {
    const queue = await admin()(`/admin/content-features?reviewStatus=unreviewed&titleId=${titleId}`).expect(200);
    expect(queue.body.total).toBe(1);
    const [feature] = queue.body.items;
    expect(feature.title).toMatchObject({ titleEn: 'Admin Check' });

    const sample = await admin()(`/admin/content-features/sample?size=5&extractorVersion=e2e-extractor-v1`).expect(200);
    expect(sample.body.items.map((item: { id: string }) => item.id)).toContain(feature.id);

    const reviewed = await request(app.getHttpServer())
      .post(`/admin/content-features/${feature.id}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reviewStatus: 'human_verified', correctedValue: 0.8, note: 'watched it: much faster' })
      .expect(201);
    expect(reviewed.body.feature).toMatchObject({ id: feature.id, reviewStatus: 'human_verified', value: 0.5 });
    expect(reviewed.body.correction).toMatchObject({ value: 0.8, extractorVersion: HUMAN_REVIEW_EXTRACTOR, reviewStatus: 'human_verified' });
    expect(reviewed.body.feature.supersededBy).toBe(reviewed.body.correction.id);

    // ADMIN-W4 (ADM-P0-02): a correction must reach the published fingerprint
    // in the same request, not wait on a separately-run republish script.
    expect(reviewed.body.republish.changes).toEqual(expect.arrayContaining([expect.objectContaining({ featureKey: 'pacing', before: 0.5, after: 0.8 })]));
    const titleAfter = await admin()(`/admin/titles/${titleId}`).expect(200);
    expect((titleAfter.body.fingerprint as { pacing: number }).pacing).toBe(0.8);

    const after = await admin()(`/admin/content-features?titleId=${titleId}`).expect(200);
    expect(after.body.items).toHaveLength(1);
    expect(after.body.items[0].id).toBe(reviewed.body.correction.id);
    const provenance = await admin()(`/admin/titles/${titleId}/provenance`).expect(200);
    expect(provenance.body.features).toHaveLength(2);
  });

  it('registers model versions and keeps exactly one active', async () => {
    const suffix = Date.now();
    const v1 = `e2e-model-${suffix}-a`;
    const v2 = `e2e-model-${suffix}-b`;
    const v3 = `e2e-model-${suffix}-unregistered`;
    for (const version of [v1, v2]) {
      await request(app.getHttpServer())
        .post('/admin/models')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ version, rankerType: 'plackett-luce', fingerprintSchemaVersion: 'v1+v2' })
        .expect(201);
    }
    await request(app.getHttpServer())
      .post('/admin/models')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: v1, rankerType: 'plackett-luce', fingerprintSchemaVersion: 'v1+v2' })
      .expect(409);

    await request(app.getHttpServer()).patch(`/admin/models/${v1}`).set('Authorization', `Bearer ${adminToken}`).send({ active: true }).expect(200);
    await request(app.getHttpServer()).patch(`/admin/models/${v2}`).set('Authorization', `Bearer ${adminToken}`).send({ active: true }).expect(200);
    const active = await models.find({ where: { active: true } });
    expect(active.map((row) => row.version)).toEqual([v2]);

    // ADMIN-W1 (ADR-117 ADM-P0-01): the wire shape is snapshotCount/
    // profileCount end to end, not the query builder's internal aliases.
    // v1 gets two snapshots across two profiles (registered, with stats);
    // v3 gets one snapshot but is never registered.
    const profileRows = await profiles.save([
      profiles.create({ userId: adminId, name: 'e2e admin profile' }),
      profiles.create({ userId: userId, name: 'e2e plain profile' }),
    ]);
    await snapshots.save([
      snapshots.create({ profileId: profileRows[0].id, weights: [0.1], modelVersion: v1, trainingTriadCount: 5 }),
      snapshots.create({ profileId: profileRows[1].id, weights: [0.2], modelVersion: v1, trainingTriadCount: 8 }),
      snapshots.create({ profileId: profileRows[0].id, weights: [0.3], modelVersion: v3, trainingTriadCount: 3 }),
    ]);

    const list = await admin()('/admin/models').expect(200);
    const registeredV1 = list.body.versions.find((row: { version: string }) => row.version === v1);
    expect(registeredV1.stats).toMatchObject({ modelVersion: v1, snapshotCount: 2, profileCount: 2 });
    expect(registeredV1.stats.snapshots).toBeUndefined();
    expect(registeredV1.stats.profiles).toBeUndefined();
    expect(list.body.versions.some((row: { version: string; active: boolean }) => row.version === v2 && row.active)).toBe(true);
    const unregisteredV3 = list.body.unregistered.find((row: { modelVersion: string }) => row.modelVersion === v3);
    expect(unregisteredV3).toMatchObject({ modelVersion: v3, snapshotCount: 1, profileCount: 1 });

    await admin()('/admin/experiments').expect(200);
    const triads = await admin()('/admin/triads/latest?limit=5').expect(200);
    expect(Array.isArray(triads.body)).toBe(true);
  });

  it('manages accounts: cannot touch itself, deactivation ends sessions at once, everything audited', async () => {
    const self = await request(app.getHttpServer())
      .patch(`/admin/users/${adminId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: false })
      .expect(403);
    expect(self.body).toMatchObject({ reason: 'self_change' });

    const list = await admin()('/admin/users?query=plain-&limit=200').expect(200);
    expect(list.body.items.some((row: { id: string; role: string }) => row.id === userId && row.role === 'user')).toBe(true);

    const deactivated = await request(app.getHttpServer())
      .patch(`/admin/users/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: false, reason: 'e2e takeover drill' })
      .expect(200);
    expect(deactivated.body).toMatchObject({ id: userId, active: false });
    await request(app.getHttpServer()).get('/profiles').set('Authorization', `Bearer ${userToken}`).expect(401);
    const sessions = await refreshTokens.find({ where: { userId } });
    expect(sessions.every((row) => row.revokedReason === 'deactivated')).toBe(true);

    const trail = await admin()(`/admin/audit-log?resource=user&resourceId=${userId}`).expect(200);
    expect(trail.body.items[0]).toMatchObject({ actorUserId: adminId, action: 'admin.user.update', status: 'ok' });
    expect(trail.body.items[0].reason).toContain('e2e takeover drill');

    const privacy = await admin()('/admin/privacy-requests?limit=5').expect(200);
    expect(privacy.body).toMatchObject({ page: 1, limit: 5 });
  });

  // ADMIN-W4: the last-active-admin guard (AdminOpsService.updateUser) counts
  // active admins *excluding the target*. Since the acting admin is always
  // excluded from their own self-change (blocked above) and always remains
  // active for anyone else's change, that count can never legitimately reach
  // zero through this endpoint -- it is defence-in-depth against a stale
  // actor row (e.g. concurrently deactivated outside this request), covered
  // directly at the unit level in admin-ops.service.spec.ts by mocking the
  // count to 0. What an e2e run over real HTTP calls *can* prove is the
  // opposite direction: that the guard does not falsely block a legitimate
  // two-admin handover.
  it('lets one admin demote another as long as an active admin remains', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const auth = app.get(AuthService);
    const account = await auth.register({ email: `admin2-${suffix}@example.com`, password: PASSWORD, firstName: 'Bo', lastName: 'Second' });
    const secondAdminId = account.user.id as string;
    await users.update({ id: secondAdminId }, { role: 'admin' });

    await request(app.getHttpServer())
      .patch(`/admin/users/${secondAdminId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'user' })
      .expect(200);
  });
});
