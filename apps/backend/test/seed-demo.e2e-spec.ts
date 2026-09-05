import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource, IsNull } from 'typeorm';
import { getConnectionOptions } from '../src/config/database.config';
import { Consent } from '../src/entities/consent.entity';
import { ContentFeature } from '../src/entities/content-feature.entity';
import { Profile } from '../src/entities/profile.entity';
import { Title } from '../src/entities/title.entity';
import { featureRowsFor } from '../src/scripts/seed-demo.lib';
import { Triad } from '../src/entities/triad.entity';
import { TriadReplacement } from '../src/entities/triad-replacement.entity';
import { User } from '../src/entities/user.entity';
import { UserTitleState } from '../src/entities/user-title-state.entity';
import { cleanDemo, loadFixtures, resolveFixturesDir, seedDemo } from '../src/scripts/seed-demo';

// The demo seed against the disposable postgres-test database (never the
// dev database): a full run must be deterministic and idempotent, and the
// rows it writes must satisfy the invariants the app relies on.
describe('seed-demo (postgres-test)', () => {
  let dataSource: DataSource;
  const fixturesDir = resolveFixturesDir();
  const { catalog, personas } = loadFixtures(fixturesDir);
  const catalogTitleCount = catalog.length;
  const now = new Date('2026-09-03T12:00:00Z');

  beforeAll(async () => {
    dataSource = new DataSource({ ...getConnectionOptions(), synchronize: false });
    await dataSource.initialize();
  }, 30_000);

  afterAll(async () => {
    await cleanDemo(dataSource.manager, personas.emailDomain);
    await dataSource.destroy();
  });

  async function snapshot() {
    const users = await dataSource.getRepository(User).find({ where: personas.personas.map((p) => ({ email: `${p.slug}@${personas.emailDomain}` })) });
    const profiles = await dataSource.getRepository(Profile).find({ where: users.map((user) => ({ userId: user.id })) });
    const profileIds = profiles.map((profile) => profile.id);
    const states = await dataSource.getRepository(UserTitleState).find({ where: profileIds.map((profileId) => ({ profileId })) });
    // Profile ids are new on every run, so order by the persona's email (stable) then time.
    const emailByProfileId = new Map(
      profiles.map((profile) => [profile.id, users.find((user) => user.id === profile.userId)?.email ?? '']),
    );
    const triads = (
      await dataSource.getRepository(Triad).find({ where: profileIds.map((profileId) => ({ profileId })) })
    ).sort(
      (left, right) =>
        emailByProfileId.get(left.profileId)!.localeCompare(emailByProfileId.get(right.profileId)!) ||
        (left.shownAt?.getTime() ?? 0) - (right.shownAt?.getTime() ?? 0),
    );
    const replacements = await dataSource.getRepository(TriadReplacement).find({ where: triads.map((triad) => ({ triadId: triad.id })) });
    const consents = await dataSource.getRepository(Consent).find({ where: users.map((user) => ({ userId: user.id })) });
    return { users, profiles, states, triads, replacements, consents };
  }

  // What a release runs (ADR-90): titles and their provenance rows, and
  // nothing under the persona accounts -- a deploy must never create a user
  // with the fixture's public password.
  it('--catalog-only seeds titles and provenance and leaves the accounts alone', async () => {
    await cleanDemo(dataSource.manager, personas.emailDomain);
    const summary = await seedDemo(dataSource, { fixturesDir, now, catalogOnly: true });

    expect(summary.titlesUpserted).toBe(catalogTitleCount);
    expect(summary.contentFeatureRows).toBeGreaterThan(0);
    expect(summary).toMatchObject({ demoUsersRemoved: 0, personas: [] });
    expect(await dataSource.getRepository(Title).count()).toBeGreaterThanOrEqual(catalogTitleCount);
    const users = await dataSource
      .getRepository(User)
      .find({ where: personas.personas.map((p) => ({ email: `${p.slug}@${personas.emailDomain}` })) });
    expect(users).toHaveLength(0);
  });

  it('seeds the four personas, deterministically and idempotently', async () => {
    const first = await seedDemo(dataSource, { fixturesDir, now });
    const firstRows = await snapshot();

    expect(first.titlesUpserted).toBe(catalogTitleCount);
    expect(firstRows.users).toHaveLength(4);
    expect(firstRows.profiles).toHaveLength(4);
    expect(firstRows.profiles.every((profile) => profile.market === 'SA' && profile.preferredLanguage === 'ar')).toBe(true);
    expect(firstRows.consents).toHaveLength(8);

    const bySlug = Object.fromEntries(first.personas.map((persona) => [persona.slug, persona]));
    expect(bySlug['slow-burn']).toMatchObject({ watched: 60, triadsCompleted: 25, replacements: 2, importedRatings: 3 });
    // Forced into round 3; being eligible, it may also be drawn again later.
    expect(bySlug['slow-burn'].triadsWithPartialTitle).toBeGreaterThanOrEqual(1);
    expect(bySlug['spectacle']).toMatchObject({ watched: 39, notWatched: 6, triadsCompleted: 12, triadsActive: 1, replacements: 1 });
    expect(bySlug['warm-talky']).toMatchObject({ watched: 30, triadsCompleted: 6 });
    expect(bySlug['newcomer']).toMatchObject({ watched: 12, triadsCompleted: 2 });

    // Invariants the app relies on.
    const completed = firstRows.triads.filter((triad) => triad.status === 'completed');
    expect(completed).toHaveLength(45);
    expect(firstRows.triads.filter((triad) => triad.status === 'active')).toHaveLength(1);
    for (const triad of completed) {
      expect(triad.ranking).not.toBeNull();
      expect([...triad.ranking!].sort()).toEqual([...triad.titleIds].sort());
      expect(triad.answeredAt!.getTime()).toBeGreaterThan(triad.shownAt!.getTime());
      expect(triad.policyVersion).toBe(personas.policyVersion);
      expect(triad.modelVersion).toBeNull();
    }
    const watchedIds = new Set(firstRows.states.filter((state) => state.state === 'watched').map((state) => `${state.profileId}:${state.titleId}`));
    for (const triad of firstRows.triads) {
      for (const titleId of triad.titleIds) {
        expect(watchedIds.has(`${triad.profileId}:${titleId}`)).toBe(true);
      }
    }
    // A replaced title never sits in ITS OWN profile's triads; its replacement
    // does. Scoped per profile: the same titleId can be validly replaced for one
    // persona while sitting in a different persona's own triad -- both draw from
    // the same 300-title catalog, so that overlap is normal, not a defect.
    const triadProfileById = new Map(firstRows.triads.map((triad) => [triad.id, triad.profileId]));
    const inTriadsByProfile = new Map<string, Set<string>>();
    for (const triad of firstRows.triads) {
      const set = inTriadsByProfile.get(triad.profileId) ?? new Set<string>();
      triad.titleIds.forEach((titleId) => set.add(titleId));
      inTriadsByProfile.set(triad.profileId, set);
    }
    for (const replacement of firstRows.replacements) {
      const inTriads = inTriadsByProfile.get(triadProfileById.get(replacement.triadId)!) ?? new Set<string>();
      expect(inTriads.has(replacement.replacedTitleId)).toBe(false);
      expect(inTriads.has(replacement.replacementTitleId!)).toBe(true);
    }
    const notRemembered = firstRows.states.filter((state) => !state.triadEligible);
    expect(notRemembered).toHaveLength(2);
    expect(firstRows.states.filter((state) => state.ratingSource === 'import')).toHaveLength(3);

    // Provenance rows: one per known feature of every DEMO title, upserted, older versions superseded.
    const { catalog } = loadFixtures(fixturesDir);
    const expectedRows = catalog.reduce((sum, entry) => sum + featureRowsFor(entry, 'x', now).length, 0);
    expect(first.contentFeatureRows).toBe(expectedRows);
    const demoTitles = await dataSource.getRepository(Title).find({ where: catalog.slice(0, 1).map((entry) => ({ internalId: entry.internalId })) });
    // Only current rows: this database is long-lived across the session's
    // many runs, so an earlier extractor version of the same title (superseded,
    // never deleted -- SCHEMA.md §2.3) can still be sitting there from before.
    const firstTitleRows = await dataSource.getRepository(ContentFeature).find({ where: { titleId: demoTitles[0].id, supersededBy: IsNull() } });
    expect(firstTitleRows.length).toBe(featureRowsFor(catalog[0], demoTitles[0].id, now).length);
    expect(firstTitleRows.every((row) => (row.value !== null) !== (row.distribution !== null) && row.supersededBy === null)).toBe(true);
    expect(firstTitleRows.some((row) => row.featureKey === 'cultural.originalLanguage' && row.distribution !== null)).toBe(true);
    // An older extractor version of one feature, planted before the second run, must end up superseded by the current row.
    // Baseline captured right before the plant, not assumed to be firstTitleRows.length:
    // this database is long-lived across the session's many runs, so stale
    // superseded rows from earlier fixture epochs may already sit here too.
    const totalBeforePlant = await dataSource.getRepository(ContentFeature).count({ where: { titleId: demoTitles[0].id } });
    const planted = await dataSource.getRepository(ContentFeature).save({
      titleId: demoTitles[0].id,
      featureKey: 'pacing',
      value: 0.1,
      uncertainty: null,
      sourceIds: [],
      extractorVersion: 'enrichment-worker-v1',
      licenseStatus: 'unknown',
      reviewStatus: 'unreviewed',
      validFrom: new Date('2026-01-01T00:00:00Z'),
    });

    // Second run: same counts, same rankings, no duplicates.
    const second = await seedDemo(dataSource, { fixturesDir, now });
    const plantedAfter = await dataSource.getRepository(ContentFeature).findOneByOrFail({ id: planted.id });
    // Whatever extractor version is current for pacing right now (not a hardcoded
    // one -- the fixture's own version drifts as the catalog is re-extracted).
    const currentPacing = await dataSource
      .getRepository(ContentFeature)
      .findOneByOrFail({ titleId: demoTitles[0].id, featureKey: 'pacing', supersededBy: IsNull() });
    expect(plantedAfter.supersededBy).toBe(currentPacing.id);
    expect(currentPacing.supersededBy).toBeNull();
    expect(second.contentFeatureRowsSuperseded).toBe(1);
    expect(await dataSource.getRepository(ContentFeature).count({ where: { titleId: demoTitles[0].id } })).toBe(totalBeforePlant + 1);
    await dataSource.getRepository(ContentFeature).delete({ id: planted.id });
    const secondRows = await snapshot();
    expect(second.personas).toEqual(first.personas.map((persona) => ({ ...persona, profileId: expect.any(String) })));
    expect(secondRows.users).toHaveLength(4);
    expect(secondRows.states).toHaveLength(firstRows.states.length);
    expect(secondRows.triads.map((triad) => triad.ranking)).toEqual(firstRows.triads.map((triad) => triad.ranking));
    expect(secondRows.triads.map((triad) => triad.titleIds)).toEqual(firstRows.triads.map((triad) => triad.titleIds));
  }, 120_000);
});
