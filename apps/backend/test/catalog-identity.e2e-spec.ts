import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getConnectionOptions } from '../src/config/database.config';
import { CatalogIdentityGuards1788490000000 } from '../src/migrations/1788490000000-CatalogIdentityGuards';
import { assertCumulativeIdentities, assertUniqueIdentities, ID_PROVIDERS } from '../src/scripts/catalog-identity';
import { loadFixtures, resolveFixturesDir, seedDemo } from '../src/scripts/seed-demo';

describe('catalog identity (dedicated postgres-test)', () => {
  let db: DataSource;
  const { catalog } = loadFixtures(resolveFixturesDir());
  beforeAll(async () => {
    const options = getConnectionOptions();
    if (!options.database.endsWith('_test')) throw new Error('test database required');
    db = await new DataSource({ ...options, synchronize: false }).initialize();
  });
  afterAll(async () => {
    await db.query(`DELETE FROM titles WHERE "internalId" LIKE 'CAT1_TEST_%'`);
    await db.destroy();
  });

  async function insert(internalId: string, ids: Record<string, unknown>) {
    return db.query(`INSERT INTO titles ("internalId", "titleEn", "titleAr", "externalIds") VALUES ($1, 'Same title', 'عنوان اختبار', $2) RETURNING id`, [internalId, JSON.stringify(ids)]);
  }

  it('seeds admitted works twice with zero collisions and identical UUID/identity readback', async () => {
    await seedDemo(db, { catalogOnly: true });
    const read = () => db.query(`SELECT id, "internalId", "externalIds" FROM titles WHERE "internalId" LIKE 'DEMO%' ORDER BY "internalId"`);
    const before = await read();
    expect(before).toHaveLength(catalog.length);
    assertUniqueIdentities(before);
    assertCumulativeIdentities(catalog, before, true);
    await seedDemo(db, { catalogOnly: true });
    expect(await read()).toEqual(before);
  });

  it.each(ID_PROVIDERS)('rejects direct %s duplicates and update/remove rebinds', async (provider) => {
    const value = catalog.find((e) => e.externalIds[provider])!.externalIds[provider];
    await expect(insert(`CAT1_TEST_DUP_${provider}`, { [provider]: value })).rejects.toMatchObject({ code: '23505' });
    const original = catalog.find((e) => e.externalIds[provider])!;
    const changed = { ...original.externalIds, [provider]: provider === 'wikidata' ? 'Q999999991' : provider === 'imdb' ? 'tt999999991' : '999999991' };
    await expect(db.query(`UPDATE titles SET "externalIds" = $1 WHERE "internalId" = $2`, [JSON.stringify(changed), original.internalId])).rejects.toMatchObject({ code: '23514' });
    delete changed[provider];
    await expect(db.query(`UPDATE titles SET "externalIds" = $1 WHERE "internalId" = $2`, [JSON.stringify(changed), original.internalId])).rejects.toMatchObject({ code: '23514' });
  });

  it('seed preflight rejects a legacy rebind before touching any catalog row or account', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'movie-cat1-fixture-'));
    const incoming = { ...catalog[0], internalId: 'DEMO9999', externalIds: { wikidata: 'Q999999987' } };
    try {
      copyFileSync(join(resolveFixturesDir(), 'personas.demo.json'), join(dir, 'personas.demo.json'));
      writeFileSync(join(dir, 'catalog.demo.json'), JSON.stringify([incoming]));
      writeFileSync(join(dir, 'catalog.demo.identity.json'), JSON.stringify([incoming]));
      await insert(incoming.internalId, { wikidata: 'Q999999986' });
      const read = () => db.query(`SELECT id, "internalId", "externalIds", "updatedAt" FROM titles ORDER BY "internalId"`);
      const before = await read();
      const accounts = await db.query('SELECT id FROM users ORDER BY id');
      await expect(seedDemo(db, { fixturesDir: dir })).rejects.toThrow('identity rebind DEMO9999');
      expect(await read()).toEqual(before);
      expect(await db.query('SELECT id FROM users ORDER BY id')).toEqual(accounts);
    } finally {
      await db.query(`DELETE FROM titles WHERE "internalId" = 'DEMO9999'`);
      rmSync(dir, { recursive: true });
    }
  });

  it('rejects internalId rebind and malformed provider spellings, permits additive IDs and editions', async () => {
    await expect(db.query(`UPDATE titles SET "internalId" = 'CAT1_TEST_REBOUND' WHERE "internalId" = $1`, [catalog[0].internalId])).rejects.toMatchObject({ code: '23514' });
    for (const value of ['', ' q1', 'q1', null, 99]) {
      await expect(insert('CAT1_TEST_BAD', { wikidata: value })).rejects.toMatchObject({ code: '23514' });
    }
    const [first] = await insert('CAT1_TEST_REMAKE_A', { wikidata: 'Q999999991' });
    await insert('CAT1_TEST_REMAKE_B', { wikidata: 'Q999999992' });
    await db.query(`UPDATE titles SET "externalIds" = '{"wikidata":"Q999999991","tmdb":"999999991"}' WHERE id = $1`, [first.id]);
    await db.query(`INSERT INTO title_editions ("titleId", kind) VALUES ($1, 'dub'), ($1, 'directors_cut')`, [first.id]);
    const [{ count }] = await db.query(`SELECT count(*)::int FROM title_editions WHERE "titleId" = $1`, [first.id]);
    expect(count).toBe(2);
  });

  it('database uniqueness arbitrates two concurrent writers', async () => {
    const outcomes = await Promise.allSettled([
      insert('CAT1_TEST_RACE_A', { tmdb: '999999993' }), insert('CAT1_TEST_RACE_B', { tmdb: '999999993' }),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('migration rejects conflicting legacy data without rewriting it', async () => {
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query('CREATE SCHEMA cat1_legacy_test');
      await runner.query('SET LOCAL search_path TO cat1_legacy_test');
      await runner.query('CREATE TABLE titles (id uuid, "internalId" text, "externalIds" json)');
      await runner.query(`INSERT INTO titles ("internalId", "externalIds") VALUES ('old1', '{"wikidata":"Q1"}'), ('old2', '{"wikidata":"Q1"}')`);
      await runner.query('SAVEPOINT guard_attempt');
      await expect(new CatalogIdentityGuards1788490000000().up(runner)).rejects.toMatchObject({ code: '23505' });
      await runner.query('ROLLBACK TO SAVEPOINT guard_attempt');
      const rows = await runner.query('SELECT "internalId", "externalIds" FROM titles ORDER BY "internalId"');
      expect(rows).toEqual([{ internalId: 'old1', externalIds: { wikidata: 'Q1' } }, { internalId: 'old2', externalIds: { wikidata: 'Q1' } }]);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
});
