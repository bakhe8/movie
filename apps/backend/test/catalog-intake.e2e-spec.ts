import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, type Repository } from 'typeorm';
import { AppModule } from '../src/modules/app/app.module';
import { CatalogIntake } from '../src/entities/catalog-intake.entity';
import { Title } from '../src/entities/title.entity';
import { User } from '../src/entities/user.entity';
import { AddCatalogIntake1788502000000 } from '../src/migrations/1788502000000-AddCatalogIntake';
import { AuthService } from '../src/modules/auth/auth.service';
import { CatalogIntakeService } from '../src/modules/catalog-intake/catalog-intake.service';
import { ADMIT_DISABLED_REASON, CATALOG_JOB_TYPES } from '../src/modules/catalog-intake/catalog-jobs.service';
import type { ResolvedFacts } from '../src/modules/catalog-intake/sources/catalog-source';

const PASSWORD = 'CorrectHorseBattery1';
const PREFIX = 'CATJ1E2E';

// CAT-J1 (ADR-121): the intake path end to end on the real test database --
// the migration both ways, the four job types inside ADMIN-W5's allowlist,
// the read-only reports, the always-refusing admit, and the intake table's
// own guards. No network: the Wikidata adapter is never called here; facts
// are handed to the service the way the adapter would return them.
describe('catalog intake (CAT-J1)', () => {
  let app: INestApplication;
  let adminToken: string;
  let userToken: string;
  let db: DataSource;
  let intakeRepo: Repository<CatalogIntake>;
  let titles: Repository<Title>;
  let users: Repository<User>;
  let intake: CatalogIntakeService;
  const createdIntakeIds: string[] = [];
  const createdTitleIds: string[] = [];

  const admin = (path: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${adminToken}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    db = app.get(DataSource);
    intakeRepo = app.get<Repository<CatalogIntake>>(getRepositoryToken(CatalogIntake));
    titles = app.get<Repository<Title>>(getRepositoryToken(Title));
    users = app.get<Repository<User>>(getRepositoryToken(User));
    intake = app.get(CatalogIntakeService);

    const auth = app.get(AuthService);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const adminAccount = await auth.register({ email: `catj1-admin-${suffix}@example.com`, password: PASSWORD, firstName: 'Ada', lastName: 'Admin' });
    await users.update({ id: adminAccount.user.id as string }, { role: 'admin' });
    adminToken = (await auth.login({ email: `catj1-admin-${suffix}@example.com`, password: PASSWORD })).access_token;
    await auth.register({ email: `catj1-user-${suffix}@example.com`, password: PASSWORD, firstName: 'Uma', lastName: 'User' });
    userToken = (await auth.login({ email: `catj1-user-${suffix}@example.com`, password: PASSWORD })).access_token;
  }, 30_000);

  afterAll(async () => {
    if (createdIntakeIds.length > 0) await intakeRepo.delete(createdIntakeIds);
    if (createdTitleIds.length > 0) await titles.delete(createdTitleIds);
    await db.query(`DELETE FROM admin_jobs WHERE type LIKE 'catalog_%'`);
    await app.close();
  });

  async function waitForTerminal(jobId: string, attempts = 60): Promise<{ status: string; result: Record<string, unknown> | null; lastError: string | null; attempts: number }> {
    for (let i = 0; i < attempts; i += 1) {
      const response = await admin(`/admin/jobs/${jobId}`).expect(200);
      if (['succeeded', 'failed', 'cancelled'].includes(response.body.status)) return response.body;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`job ${jobId} did not reach a terminal state`);
  }

  // Not async: supertest's chainable `.expect()` lives on the request itself.
  function createJob(body: Record<string, unknown>) {
    return request(app.getHttpServer()).post('/admin/jobs').set('Authorization', `Bearer ${adminToken}`).send(body);
  }

  it('migration runs down and up again against the test database', async () => {
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const migration = new AddCatalogIntake1788502000000();
      await migration.down(runner);
      expect(await runner.hasTable('catalog_intake')).toBe(false);
      await migration.up(runner);
      expect(await runner.hasTable('catalog_intake')).toBe(true);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });

  it('registers the four catalog job types in the job center allowlist', async () => {
    const response = await admin('/admin/jobs/types').expect(200);
    const types = (response.body as { type: string; description: string }[]).map((row) => row.type);
    expect(types).toEqual(expect.arrayContaining(Object.values(CATALOG_JOB_TYPES)));
    expect(types).toContain('republish_fingerprints');
  });

  it('catalog_verify reports over the admitted catalog without writing anything', async () => {
    const before = await titles.count();
    const created = await createJob({ type: CATALOG_JOB_TYPES.verify }).expect(201);
    const job = await waitForTerminal(created.body.job.id);
    expect(job.status).toBe('succeeded');
    const result = job.result as { titlesExamined: number; reservation: { reserved: number }; provenance: unknown; evaluatorVersion: string };
    expect(result.evaluatorVersion).toBe('intake-v1');
    expect(result.titlesExamined).toBe(before);
    expect(result.reservation.reserved).toBeGreaterThanOrEqual(389);
    expect(result.provenance).toBeDefined();
    expect(await titles.count()).toBe(before);
  });

  it('catalog_reconcile compares the committed fixture with the database, read-only', async () => {
    const created = await createJob({ type: CATALOG_JOB_TYPES.reconcile, params: { driftLimit: 5 } }).expect(201);
    const job = await waitForTerminal(created.body.job.id);
    expect(job.status).toBe('succeeded');
    const result = job.result as { fixtureEntries: number; drift: unknown[]; driftTotal: number };
    expect(result.fixtureEntries).toBeGreaterThanOrEqual(389);
    expect(result.drift.length).toBeLessThanOrEqual(5);
    expect(result.driftTotal).toBeGreaterThanOrEqual(result.drift.length);
    await createJob({ type: CATALOG_JOB_TYPES.reconcile, params: { driftLimit: -1 } }).expect(400);
  });

  it('catalog_admit refuses every call without retrying', async () => {
    await createJob({ type: CATALOG_JOB_TYPES.admit, params: {} }).expect(400);
    const created = await createJob({ type: CATALOG_JOB_TYPES.admit, params: { intakeId: '11111111-1111-4111-8111-111111111111' } }).expect(201);
    const job = await waitForTerminal(created.body.job.id);
    expect(job.status).toBe('failed');
    expect(job.attempts).toBe(1);
    expect(job.lastError).toContain('DEPENDENCY_DISABLED');
    expect(ADMIT_DISABLED_REASON).toContain('PUB-G1');
  });

  it('catalog_pull validates its parameters before any row is written', async () => {
    const before = await db.query(`SELECT COUNT(*)::int AS n FROM admin_jobs WHERE type = 'catalog_pull'`);
    await createJob({ type: CATALOG_JOB_TYPES.pull, params: { source: 'imdb-scrape' } }).expect(400);
    await createJob({ type: CATALOG_JOB_TYPES.pull, params: { criteria: {} } }).expect(400);
    await createJob({ type: CATALOG_JOB_TYPES.pull, params: { criteria: { countryQids: ['Egypt'] } } }).expect(400);
    await createJob({ type: CATALOG_JOB_TYPES.pull, params: { criteria: { countryQids: ['Q79'], limit: 9999 } } }).expect(400);
    const after = await db.query(`SELECT COUNT(*)::int AS n FROM admin_jobs WHERE type = 'catalog_pull'`);
    expect(after[0].n).toBe(before[0].n);
  });

  describe('intake rows', () => {
    const facts = (overrides: Partial<ResolvedFacts> = {}): ResolvedFacts => {
      const prov = { source: 'wikidata', license: 'CC0 1.0', licenseStatus: 'commercial_allowed' as const, url: 'https://www.wikidata.org/wiki/Q999999901', retrievedAt: new Date().toISOString() };
      return {
        wikidataId: 'Q999999901',
        imdbId: 'tt9999901',
        tmdbId: '999999901',
        titleEn: { value: `${PREFIX} Candidate`, provenance: prov },
        titleAr: { value: 'مرشح اختبار', provenance: prov },
        description: { value: 'A candidate for the intake e2e.', provenance: { ...prov, source: 'wikipedia:en' } },
        descriptionIsStub: false,
        descriptionAr: null,
        releaseYear: { value: 1999, provenance: prov },
        genres: { value: ['Drama'], provenance: prov },
        unmappedGenres: [],
        originalLanguage: { value: 'ar', provenance: prov },
        countries: { value: ['EG'], provenance: prov },
        isFilm: true,
        labelEn: null,
        warnings: [],
        ...overrides,
      };
    };
    const candidate = (overrides: Record<string, unknown> = {}) => ({
      source: 'wikidata',
      wikidataId: 'Q999999901',
      imdbId: 'tt9999901',
      tmdbId: '999999901',
      titleEn: `${PREFIX} Candidate`,
      year: 1999,
      sitelinks: 12,
      originalLanguageLabel: 'Arabic',
      criteria: { slice: 'e2e' },
      ...overrides,
    });

    it('records a candidate as blocked (no poster yet), re-evaluates it on a second pass, and never creates a title', async () => {
      const titlesBefore = await titles.count();
      const context = { admittedIndex: await intake.admittedIdentityIndex(), probes: await intake.duplicateProbes(), now: new Date(), dryRun: false };
      const first = await intake.recordCandidate(candidate(), facts(), null, context);
      createdIntakeIds.push(first.id);
      expect(first.created).toBe(true);
      expect(first.status).toBe('blocked');
      expect(first.evaluation.blockerCodes).toEqual(['POSTER_MISSING']);

      const second = await intake.recordCandidate(candidate(), facts(), null, { ...context, probes: await intake.duplicateProbes(first.id) });
      expect(second.created).toBe(false);
      expect(second.id).toBe(first.id);
      const row = await intakeRepo.findOneByOrFail({ id: first.id });
      expect(row.attempts).toBe(2);
      expect(row.evaluatorVersion).toBe('intake-v1');
      expect(row.provenance.description.source).toBe('wikipedia:en');
      expect(await titles.count()).toBe(titlesBefore);
    });

    it('keeps the last good values and marks a failed fetch, without inventing anything', async () => {
      const context = { admittedIndex: await intake.admittedIdentityIndex(), probes: [], now: new Date(), dryRun: false };
      const outcome = await intake.recordCandidate(candidate(), null, 'SourceHttpError: HTTP 503 for https://query.wikidata.org/sparql?query=x&api_key=SECRET', context);
      expect(outcome.evaluation.blockerCodes).toContain('SOURCE_FETCH_FAILED');
      const row = await intakeRepo.findOneByOrFail({ id: outcome.id });
      expect(row.titleAr).toBe('مرشح اختبار');
      expect(row.lastError).toContain('HTTP 503');
    });

    it('flags a candidate whose provider id is already admitted as a duplicate of that title', async () => {
      const title = await titles.save(
        titles.create({ internalId: `${PREFIX}0001`, titleEn: `${PREFIX} Admitted`, titleAr: 'مُدرَج', externalIds: { wikidata: 'Q999999902', imdb: 'tt9999902' } }),
      );
      createdTitleIds.push(title.id);
      const context = { admittedIndex: await intake.admittedIdentityIndex(), probes: await intake.duplicateProbes(), now: new Date(), dryRun: false };
      const outcome = await intake.recordCandidate(
        candidate({ wikidataId: 'Q999999903', imdbId: 'tt9999902', tmdbId: '999999903' }),
        facts({ wikidataId: 'Q999999903', imdbId: 'tt9999902', tmdbId: '999999903' }),
        null,
        context,
      );
      createdIntakeIds.push(outcome.id);
      expect(outcome.status).toBe('duplicate');
      expect((await intakeRepo.findOneByOrFail({ id: outcome.id })).duplicateOf).toBe(`${PREFIX}0001`);
    });

    it('flags a same-title-same-year candidate as a possible duplicate for a human, blocking it', async () => {
      const context = { admittedIndex: await intake.admittedIdentityIndex(), probes: await intake.duplicateProbes(), now: new Date(), dryRun: false };
      const outcome = await intake.recordCandidate(
        candidate({ wikidataId: 'Q999999904', imdbId: 'tt9999904', tmdbId: '999999904', titleEn: `${PREFIX} admitted` }),
        facts({ wikidataId: 'Q999999904', imdbId: 'tt9999904', tmdbId: '999999904', titleEn: { value: `${PREFIX} admitted`, provenance: facts().titleEn!.provenance }, releaseYear: null }),
        null,
        context,
      );
      createdIntakeIds.push(outcome.id);
      expect(outcome.status).toBe('blocked');
      expect(outcome.evaluation.blockerCodes).toContain('POSSIBLE_DUPLICATE');
      expect((await intakeRepo.findOneByOrFail({ id: outcome.id })).duplicateOf).toBe(`${PREFIX}0001`);
    });

    it('a dry run evaluates without writing', async () => {
      const before = await intakeRepo.count();
      const context = { admittedIndex: await intake.admittedIdentityIndex(), probes: [], now: new Date(), dryRun: true };
      const outcome = await intake.recordCandidate(candidate({ wikidataId: 'Q999999905', imdbId: 'tt9999905', tmdbId: '999999905' }), facts({ wikidataId: 'Q999999905', imdbId: 'tt9999905', tmdbId: '999999905' }), null, context);
      expect(outcome.created).toBe(true);
      expect(await intakeRepo.count()).toBe(before);
    });

    it('the table itself refuses a malformed id, a duplicate provider id, an id-less row and a bad status', async () => {
      await expect(db.query(`INSERT INTO catalog_intake ("wikidataId", source) VALUES ('Q0', 'wikidata')`)).rejects.toMatchObject({ code: '23514' });
      await expect(db.query(`INSERT INTO catalog_intake ("wikidataId", source) VALUES ('Q999999901', 'wikidata')`)).rejects.toMatchObject({ code: '23505' });
      await expect(db.query(`INSERT INTO catalog_intake (source) VALUES ('wikidata')`)).rejects.toMatchObject({ code: '23514' });
      await expect(db.query(`INSERT INTO catalog_intake ("wikidataId", source, status) VALUES ('Q999999906', 'wikidata', 'published')`)).rejects.toMatchObject({ code: '23514' });
      await expect(db.query(`INSERT INTO catalog_intake ("wikidataId", source, "posterPath") VALUES ('Q999999906', 'wikidata', 'https://image.tmdb.org/x.jpg')`)).rejects.toMatchObject({ code: '23514' });
    });

    it('serves the queue to admins only, with filters and stats', async () => {
      await request(app.getHttpServer()).get('/admin/catalog-intake').expect(401);
      await request(app.getHttpServer()).get('/admin/catalog-intake').set('Authorization', `Bearer ${userToken}`).expect(403);
      const list = await admin('/admin/catalog-intake?status=duplicate&limit=5').expect(200);
      expect(list.body.items.every((row: { status: string }) => row.status === 'duplicate')).toBe(true);
      expect(list.body.total).toBeGreaterThanOrEqual(1);
      const byCode = await admin('/admin/catalog-intake?blockerCode=POSSIBLE_DUPLICATE').expect(200);
      expect(byCode.body.total).toBeGreaterThanOrEqual(1);
      const stats = await admin('/admin/catalog-intake/stats').expect(200);
      expect(stats.body.total).toBeGreaterThanOrEqual(3);
      expect(stats.body.byStatus.duplicate).toBeGreaterThanOrEqual(1);
      expect(stats.body.byBlockerCode.POSSIBLE_DUPLICATE).toBeGreaterThanOrEqual(1);
      expect(stats.body.lastAttemptAt).not.toBeNull();
      const one = await admin(`/admin/catalog-intake/${createdIntakeIds[0]}`).expect(200);
      expect(one.body.id).toBe(createdIntakeIds[0]);
      await admin('/admin/catalog-intake/11111111-1111-4111-8111-111111111111').expect(404);
    });
  });
});
