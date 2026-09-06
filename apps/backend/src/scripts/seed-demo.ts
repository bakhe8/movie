/**
 * Demo data seed (docs/DEMO_DATA_PLAN_2026-09-03.md WS3).
 *
 *   npm run db:seed:demo            # upsert the 300-title catalog, rebuild the four personas
 *   npm run db:seed:demo:clean      # remove the persona accounts only (titles stay)
 *   node dist/scripts/seed-demo.js --dry-run   # validate fixtures and print the plan, touch nothing
 *   node dist/scripts/seed-demo.js --catalog-only  # titles + provenance only, no persona accounts (what a release runs, ADR-90)
 *
 * What it writes, per persona in `fixtures/personas.demo.json`: a user
 * (`<slug>@demo.local`), one Arabic-first profile that looks fully onboarded
 * (market, platforms, the two onboarding consents), a watched set sampled
 * around the persona's hidden taste, watchlist and not-watched marks, notes,
 * import-only ratings where the persona has them, completed triads answered by
 * an exact Plackett–Luce draw from that taste, the replacement rows the two
 * neutral controls would have produced, and (for one persona) an active triad.
 *
 * Guardrails (WS0): every account ends in `@demo.local`, every title id starts
 * with `DEMO`, every synthetic triad carries `policyVersion demo-synthetic-v1`;
 * a run first deletes the demo users (cascade) and upserts titles by
 * internalId, so a re-run with the same seed reproduces the same rows. Nothing
 * outside those accounts is touched; no snapshot is written — training is the
 * trainer's job (`python -m src.train_demo`).
 */
import 'reflect-metadata';
import { assertCumulativeIdentities, assertReservedIdentities, CatalogIdentity } from './catalog-identity';
import * as bcrypt from 'bcryptjs';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import { DataSource, DataSourceOptions, EntityManager } from 'typeorm';
import { DatabaseConfig } from '../config/database.config';
import { Consent, ConsentPurpose } from '../entities/consent.entity';
import { ContentFeature } from '../entities/content-feature.entity';
import { Profile } from '../entities/profile.entity';
import { Title } from '../entities/title.entity';
import { Triad } from '../entities/triad.entity';
import { TriadReplacement } from '../entities/triad-replacement.entity';
import { User } from '../entities/user.entity';
import { UserTitleState } from '../entities/user-title-state.entity';
import {
  CatalogEntry,
  PersonaSpec,
  PersonasFixture,
  SAMPLE_NOTES,
  catalogEntryToTitle,
  combinations,
  featureRowsFor,
  fingerprintVector,
  hashSeed,
  isCompleteFingerprint,
  mulberry32,
  rankByUtility,
  sample,
  sampleTriad,
  sampleWatched,
  sessionTimestamps,
  shuffle,
  spreadWatchedDates,
  utility,
  validateCatalogEntry,
  validatePersona,
} from './seed-demo.lib';

// What the onboarding screen writes for a real user (OnboardingScreen.tsx),
// so a persona is indistinguishable from an onboarded account to the app.
const CONSENT_VERSION = 'privacy-2.0';
const CONSENT_PURPOSES: ConsentPurpose[] = ['watch_history', 'personalization_individual'];
const PROFILE_NAME = 'ملف الذوق الرئيسي';
const DEMO_MARKET = 'SA';
const DEMO_PLATFORMS = ['netflix', 'shahid'];
// The deliberately partial title (WS2) that `includePartialTitle` personas watch and rank once,
// so the trainer's "drop triads with an incomplete fingerprint" rule is observable.
const PARTIAL_TITLE_ID = 'DEMO0007';
const IMPORTED_RATINGS = [8.5, 7, 9];

export interface SeedDemoOptions {
  fixturesDir?: string;
  // Titles and their provenance rows only; the persona accounts are neither
  // removed nor rebuilt. What `npm run release` runs in every environment
  // (ADR-90): the fixture's password is public, so no deploy may create them.
  catalogOnly?: boolean;
  seed?: number;
  now?: Date;
  log?: (line: string) => void;
}

export interface PersonaSummary {
  slug: string;
  email: string;
  profileId: string;
  watched: number;
  notWatched: number;
  watchlist: number;
  notes: number;
  importedRatings: number;
  triadsCompleted: number;
  triadsActive: number;
  triadsWithPartialTitle: number;
  replacements: number;
}

export interface SeedDemoSummary {
  titlesUpserted: number;
  contentFeatureRows: number;
  contentFeatureRowsSuperseded: number;
  demoUsersRemoved: number;
  personas: PersonaSummary[];
}

/**
 * The provenance behind every published fingerprint number (BP §13.3,
 * FINGERPRINT_SCHEMA.md §3): one `content_features` row per (title,
 * featureKey, extractorVersion), upserted on that key so a re-run is a
 * no-op, and older extractor versions of the same feature marked
 * `supersededBy` the new row — never deleted, never overwritten (BP §11.3).
 */
export async function seedContentFeatures(
  manager: EntityManager,
  catalog: CatalogEntry[],
  uuidByInternalId: Map<string, string>,
  now: Date,
): Promise<{ rows: number; superseded: number }> {
  const rows = catalog.flatMap((entry) => {
    const titleId = uuidByInternalId.get(entry.internalId);
    return titleId ? featureRowsFor(entry, titleId, now) : [];
  });
  const repository = manager.getRepository(ContentFeature);
  for (let start = 0; start < rows.length; start += 500) {
    await repository.upsert(rows.slice(start, start + 500), ['titleId', 'featureKey', 'extractorVersion']);
  }
  // Supersession: for each (title, feature) the newest validFrom row is current;
  // every other row of that pair that is still open points at it.
  const superseded = await manager.query(
    `
    WITH current AS (
      SELECT DISTINCT ON ("titleId", "featureKey") id, "titleId", "featureKey"
      FROM content_features
      WHERE "titleId" = ANY($1::uuid[])
      ORDER BY "titleId", "featureKey", "validFrom" DESC, id DESC
    )
    UPDATE content_features old
    SET "supersededBy" = current.id
    FROM current
    WHERE old."titleId" = current."titleId" AND old."featureKey" = current."featureKey"
      AND old.id <> current.id AND old."supersededBy" IS NULL
    `,
    [[...new Set(rows.map((row) => row.titleId))]],
  );
  const supersededCount = Array.isArray(superseded) && typeof superseded[1] === 'number' ? superseded[1] : 0;
  return { rows: rows.length, superseded: supersededCount };
}

// The source tree wins whenever it is there, and the copy beside the code is
// the fallback. The order used to be the other way round, which was a trap on
// any machine that had ever run `npm run build`: `dist/scripts/fixtures` is a
// *snapshot* taken at build time (Dockerfile), so running the compiled
// scripts locally seeded yesterday's catalogue while the tree held today's,
// silently (movie-94, 2026-09-05). In the image there is no `src/`, so the
// fallback is what runs there -- the packaged behaviour is unchanged.
// `__dirname` is <backend>/src/scripts under tsx and <backend>/dist/scripts
// when compiled, so '../../src/scripts/fixtures' resolves the same either way.
export function resolveFixturesDir(): string {
  const fromSource = path.resolve(__dirname, '..', '..', 'src', 'scripts', 'fixtures');
  if (existsSync(fromSource)) {
    return fromSource;
  }
  return path.resolve(__dirname, 'fixtures'); // packaged: copied beside the code
}

export function loadFixtures(fixturesDir: string): { catalog: CatalogEntry[]; personas: PersonasFixture } {
  const catalog = JSON.parse(readFileSync(path.join(fixturesDir, 'catalog.demo.json'), 'utf8')) as CatalogEntry[];
  const personas = JSON.parse(readFileSync(path.join(fixturesDir, 'personas.demo.json'), 'utf8')) as PersonasFixture;
  const reserved = JSON.parse(readFileSync(path.join(fixturesDir, 'catalog.demo.identity.json'), 'utf8')) as CatalogIdentity[];
  assertReservedIdentities(reserved, catalog);
  const problems = [
    ...catalog.flatMap((entry) => validateCatalogEntry(entry).map((problem) => `${entry.internalId}: ${problem}`)),
    ...personas.personas.flatMap(validatePersona),
  ];
  if (problems.length > 0) {
    throw new Error(`demo fixtures are invalid:\n  ${problems.join('\n  ')}`);
  }
  return { catalog, personas };
}

/** Remove the persona accounts (users cascade to profiles, states, triads, replacements, snapshots, consents). */
export async function cleanDemo(manager: EntityManager, emailDomain: string): Promise<number> {
  const result = await manager
    .createQueryBuilder()
    .delete()
    .from(User)
    .where('email LIKE :pattern', { pattern: `%@${emailDomain}` })
    .execute();
  return result.affected ?? 0;
}

export async function seedDemo(dataSource: DataSource, options: SeedDemoOptions = {}): Promise<SeedDemoSummary> {
  const log = options.log ?? (() => undefined);
  const now = options.now ?? new Date();
  const { catalog, personas } = loadFixtures(options.fixturesDir ?? resolveFixturesDir());
  const seed = options.seed ?? personas.seed;

  return dataSource.transaction(async (manager) => {
    // Serialize against other title writers and check all namespaces before any side effect.
    await manager.query('LOCK TABLE titles IN SHARE ROW EXCLUSIVE MODE');
    const previous = await manager.getRepository(Title).find({ select: { internalId: true, externalIds: true } });
    assertCumulativeIdentities(previous, catalog);
    // 1. Catalog: entity fields only, upsert by internalId (the 15 FILM seeds are untouched).
    // `originalLanguage` is written only where the *database* has the column
    // (migration AddTrainingLanguageDiversity applied) and the entity maps it;
    // elsewhere the key is dropped so the seed works on either schema.
    const entityHasColumn = manager.connection.getMetadata(Title).columns.some((column) => column.propertyName === 'originalLanguage');
    const tableHasColumn =
      (
        await manager.query(
          `SELECT 1 FROM information_schema.columns WHERE table_name = 'titles' AND column_name = 'originalLanguage'`,
        )
      ).length > 0;
    const hasOriginalLanguage = entityHasColumn && tableHasColumn;
    const rows = catalog.map(catalogEntryToTitle).map((row) => {
      if (hasOriginalLanguage) {
        return row;
      }
      const rest = { ...row };
      delete rest.originalLanguage;
      return rest;
    });
    if (!hasOriginalLanguage) {
      log(`titles.originalLanguage skipped (entity ${entityHasColumn ? 'has' : 'lacks'} it, table ${tableHasColumn ? 'has' : 'lacks'} it)`);
    }
    await manager.getRepository(Title).upsert(rows, ['internalId']);
    const titles = await manager.getRepository(Title).find({
      where: catalog.map((entry) => ({ internalId: entry.internalId })),
      select: { id: true, internalId: true },
    });
    const uuidByInternalId = new Map(titles.map((title) => [title.internalId, title.id]));
    log(`titles: ${titles.length} upserted`);
    const features = await seedContentFeatures(manager, catalog, uuidByInternalId, now);
    log(`content_features: ${features.rows} rows upserted, ${features.superseded} older rows superseded`);
    if (options.catalogOnly) {
      log('catalog only: persona accounts untouched');
      return {
        titlesUpserted: titles.length,
        contentFeatureRows: features.rows,
        contentFeatureRowsSuperseded: features.superseded,
        demoUsersRemoved: 0,
        personas: [],
      };
    }

    // 2. A clean slate for the persona accounts, then rebuild each one.
    const demoUsersRemoved = await cleanDemo(manager, personas.emailDomain);
    log(`demo users removed: ${demoUsersRemoved}`);
    const passwordHash = await bcrypt.hash(personas.password, 10);

    const summaries: PersonaSummary[] = [];
    for (const persona of personas.personas) {
      const summary = await seedPersona(manager, persona, personas, catalog, uuidByInternalId, passwordHash, seed, now);
      log(
        `${persona.slug}: watched ${summary.watched}, watchlist ${summary.watchlist}, not_watched ${summary.notWatched}, ` +
          `triads ${summary.triadsCompleted}${summary.triadsActive ? ' + 1 active' : ''}, replacements ${summary.replacements}`,
      );
      summaries.push(summary);
    }
    return {
      titlesUpserted: titles.length,
      contentFeatureRows: features.rows,
      contentFeatureRowsSuperseded: features.superseded,
      demoUsersRemoved,
      personas: summaries,
    };
  });
}

async function seedPersona(
  manager: EntityManager,
  persona: PersonaSpec,
  fixture: PersonasFixture,
  catalog: CatalogEntry[],
  uuidByInternalId: Map<string, string>,
  passwordHash: string,
  seed: number,
  now: Date,
): Promise<PersonaSummary> {
  const rng = mulberry32(hashSeed(`${seed}:${persona.slug}`));
  const uuidOf = (internalId: string): string => {
    const uuid = uuidByInternalId.get(internalId);
    if (!uuid) {
      throw new Error(`${persona.slug}: title ${internalId} was not upserted`);
    }
    return uuid;
  };
  const utilityById = new Map(catalog.map((entry) => [entry.internalId, utility(persona.theta, fingerprintVector(entry.fingerprint))]));

  // Account and an onboarded profile.
  const email = `${persona.slug}@${fixture.emailDomain}`;
  const user = await manager.save(User, {
    email,
    password: passwordHash,
    firstName: persona.nameAr,
    lastName: 'Demo',
    active: true,
    role: 'user' as const,
  });
  const profile = await manager.save(Profile, {
    userId: user.id,
    name: PROFILE_NAME,
    preferredLanguage: 'ar' as const,
    market: DEMO_MARKET,
    platforms: DEMO_PLATFORMS,
  });
  await manager.save(
    Consent,
    CONSENT_PURPOSES.map((purpose) => ({ userId: user.id, purpose, version: CONSENT_VERSION, granted: true, grantedAt: now })),
  );

  // The watched world. Titles reserved for the replacement controls are drawn
  // first so they can never appear in a triad's titleIds.
  const watched = sampleWatched(rng, catalog, persona.theta, persona.watched, {
    mustInclude: persona.includePartialTitle ? [PARTIAL_TITLE_ID] : [],
  });
  const reservable = watched.filter((entry) => entry.internalId !== PARTIAL_TITLE_ID);
  const notRemembered = sample(rng, reservable, persona.replacements.notRemembered).map((entry) => entry.internalId);
  const flippedNotWatched = sample(
    rng,
    reservable.filter((entry) => !notRemembered.includes(entry.internalId)),
    persona.replacements.notWatched,
  ).map((entry) => entry.internalId);
  const eligibleIds = watched
    .map((entry) => entry.internalId)
    .filter((id) => !notRemembered.includes(id) && !flippedNotWatched.includes(id));

  const watchedDates = spreadWatchedDates(rng, watched.length, now);
  const notedIds = new Set(sample(rng, eligibleIds, persona.notes));
  const ratedIds = sample(rng, eligibleIds, persona.importedRatings);
  const states: Partial<UserTitleState>[] = watched.map((entry, index) => {
    const flipped = flippedNotWatched.includes(entry.internalId);
    const ratingIndex = ratedIds.indexOf(entry.internalId);
    return {
      profileId: profile.id,
      titleId: uuidOf(entry.internalId),
      state: flipped ? 'not_watched' : 'watched',
      watchedAt: flipped ? null : watchedDates[index],
      triadEligible: !notRemembered.includes(entry.internalId),
      importedRating: ratingIndex >= 0 ? IMPORTED_RATINGS[ratingIndex % IMPORTED_RATINGS.length] : null,
      ratingSource: ratingIndex >= 0 ? 'import' : null,
      notes: notedIds.has(entry.internalId) ? SAMPLE_NOTES[index % SAMPLE_NOTES.length] : null,
    };
  });

  // Watchlist from the best-fitting unwatched titles; plain not_watched marks from the rest.
  const watchedSet = new Set(watched.map((entry) => entry.internalId));
  const unwatchedByFit = catalog
    .filter((entry) => !watchedSet.has(entry.internalId))
    .sort((left, right) => (utilityById.get(right.internalId) ?? 0) - (utilityById.get(left.internalId) ?? 0));
  const watchlist = sample(rng, unwatchedByFit.slice(0, 40), persona.watchlist).map((entry) => entry.internalId);
  const notWatchedMarks = sample(
    rng,
    unwatchedByFit.filter((entry) => !watchlist.includes(entry.internalId)),
    persona.notWatched,
  ).map((entry) => entry.internalId);
  states.push(
    ...watchlist.map((id) => ({ profileId: profile.id, titleId: uuidOf(id), state: 'watchlist' as const, watchedAt: null })),
    ...notWatchedMarks.map((id) => ({ profileId: profile.id, titleId: uuidOf(id), state: 'not_watched' as const, watchedAt: null })),
  );
  await manager.save(UserTitleState, states, { chunk: 100 });

  // Completed triads: one Plackett–Luce draw each, sittings of five on distinct days.
  const timestamps = sessionTimestamps(rng, persona.triads, now);
  const completed: Triad[] = [];
  let previous: string[] = [];
  let triadsWithPartialTitle = 0;
  for (let index = 0; index < persona.triads; index += 1) {
    const mustInclude = persona.includePartialTitle && index === 2 ? PARTIAL_TITLE_ID : undefined;
    const ids = sampleTriad(rng, eligibleIds, previous, { mustInclude });
    if (!ids) {
      break; // fewer than three eligible titles left; the summary shows the shortfall
    }
    const pool = eligibleIds.filter((id) => !previous.includes(id)).length;
    const { shownAt, answeredAt, sessionIndex } = timestamps[index];
    const triad = await manager.save(Triad, {
      profileId: profile.id,
      titleIds: ids.map(uuidOf),
      displayOrder: shuffle(rng, ids).map(uuidOf),
      ranking: rankByUtility(rng, ids, utilityById, fixture.temperature).map(uuidOf),
      shownAt,
      answeredAt,
      modelVersion: null,
      idempotencyKey: null,
      policyVersion: fixture.policyVersion,
      selectionPropensity: 1 / combinations(pool, 3),
      experimentId: null,
      sessionId: `demo-${persona.slug}-s${sessionIndex + 1}`,
      metadata: { reasonForSelection: 'demo-persona' },
      status: 'completed' as const,
      holdout: false,
      correctsTriadId: null,
      createdAt: shownAt,
    });
    completed.push(triad);
    if (ids.includes(PARTIAL_TITLE_ID)) {
      triadsWithPartialTitle += 1;
    }
    previous = ids;
  }

  // Replacement rows, exactly as TriadsService.replace() would have left them:
  // the replaced title never sits in a triad; the replacement is one that does.
  const replacements: Partial<TriadReplacement>[] = [];
  notRemembered.forEach((replacedId, index) => {
    const triad = completed[index % completed.length];
    if (triad) {
      replacements.push({
        triadId: triad.id,
        replacedTitleId: uuidOf(replacedId),
        replacementTitleId: triad.titleIds[0],
        reason: 'not_remembered',
        createdAt: triad.shownAt ?? now,
      });
    }
  });
  flippedNotWatched.forEach((replacedId, index) => {
    const triad = completed[(index + 1) % completed.length];
    if (triad) {
      replacements.push({
        triadId: triad.id,
        replacedTitleId: uuidOf(replacedId),
        replacementTitleId: triad.titleIds[1],
        reason: 'not_watched',
        createdAt: triad.shownAt ?? now,
      });
    }
  });
  if (replacements.length > 0) {
    await manager.save(TriadReplacement, replacements);
  }

  // One round left open mid-way, so the Rank screen opens on it.
  let triadsActive = 0;
  if (persona.activeTriad) {
    const ids = sampleTriad(rng, eligibleIds, previous);
    if (ids) {
      const pool = eligibleIds.filter((id) => !previous.includes(id)).length;
      await manager.save(Triad, {
        profileId: profile.id,
        titleIds: ids.map(uuidOf),
        displayOrder: shuffle(rng, ids).map(uuidOf),
        ranking: null,
        shownAt: new Date(now.getTime() - 2 * 60 * 1000),
        answeredAt: null,
        modelVersion: null,
        idempotencyKey: null,
        policyVersion: fixture.policyVersion,
        selectionPropensity: 1 / combinations(pool, 3),
        experimentId: null,
        sessionId: `demo-${persona.slug}-open`,
        metadata: { reasonForSelection: 'demo-persona' },
        status: 'active' as const,
        holdout: false,
        correctsTriadId: null,
      });
      triadsActive = 1;
    }
  }

  return {
    slug: persona.slug,
    email,
    profileId: profile.id,
    watched: states.filter((state) => state.state === 'watched').length,
    notWatched: states.filter((state) => state.state === 'not_watched').length,
    watchlist: watchlist.length,
    notes: states.filter((state) => state.notes).length,
    importedRatings: states.filter((state) => state.importedRating !== null && state.importedRating !== undefined).length,
    triadsCompleted: completed.length,
    triadsActive,
    triadsWithPartialTitle,
    replacements: replacements.length,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { clean: boolean; dryRun: boolean; catalogOnly: boolean; seed: number | null } {
  return {
    clean: argv.includes('--clean'),
    dryRun: argv.includes('--dry-run'),
    catalogOnly: argv.includes('--catalog-only'),
    seed: argv.includes('--seed') ? Number(argv[argv.indexOf('--seed') + 1]) : null,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const fixturesDir = resolveFixturesDir();

  if (args.dryRun) {
    const { catalog, personas } = loadFixtures(fixturesDir);
    const complete = catalog.filter((entry) => isCompleteFingerprint(entry.fingerprint)).length;
    console.log(`fixtures valid: ${catalog.length} titles (${complete} complete fingerprints), ${personas.personas.length} personas`);
    for (const persona of personas.personas) {
      console.log(
        `  ${persona.slug}@${personas.emailDomain}: ${persona.watched} watched, ${persona.triads} triads → expected band ${persona.expectedBand}`,
      );
    }
    return;
  }

  const dataSource = new DataSource(DatabaseConfig() as DataSourceOptions);
  await dataSource.initialize();
  try {
    if (args.clean) {
      const { personas } = loadFixtures(fixturesDir);
      const removed = await cleanDemo(dataSource.manager, personas.emailDomain);
      console.log(`Removed ${removed} demo user(s) (@${personas.emailDomain}); titles untouched`);
      return;
    }
    const summary = await seedDemo(dataSource, {
      fixturesDir,
      seed: args.seed ?? undefined,
      catalogOnly: args.catalogOnly,
      log: (line) => console.log(`  ${line}`),
    });
    if (args.catalogOnly) {
      console.log(
        `\nSeeded ${summary.titlesUpserted} titles (${summary.contentFeatureRows} provenance rows, ${summary.contentFeatureRowsSuperseded} superseded); ` +
          'persona accounts untouched (--catalog-only)',
      );
      return;
    }
    const { personas } = loadFixtures(fixturesDir);
    console.log(
      `\nSeeded ${summary.titlesUpserted} titles (${summary.contentFeatureRows} provenance rows, ${summary.contentFeatureRowsSuperseded} superseded) ` +
        `and ${summary.personas.length} personas (password: ${personas.password})`,
    );
    for (const persona of summary.personas) {
      console.log(`  ${persona.email}  profile ${persona.profileId}`);
    }
    console.log('\nNext: cd services/workers && python -m src.train_demo');
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Failed to seed demo data:', error);
    process.exit(1);
  });
}
