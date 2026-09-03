/**
 * Load staged director credits (ADR-65, `fetch-director-credits.ts`) into
 * `people`/`credits`/`source_records` now that the catalog itself is loaded
 * (WS3, session C): the staged file is keyed by the fixture's own
 * `internalId`, this joins it to the real `titles.id` each row now has.
 *
 *   npm run build && node dist/scripts/load-director-credits.js [--dry-run]
 *
 * (not `tsx` -- this constructs a full TypeORM DataSource via DatabaseConfig(),
 * and tsx's on-the-fly transform doesn't reliably emit decorator metadata for
 * every entity in this graph; seed-demo.ts's own script hits the same issue
 * and is compiled for the same reason.)
 *
 * Input : src/scripts/director-credits/catalog.demo.directors.json (own file, ADR-65)
 * Reads : titles, matched by internalId -- entries whose title isn't loaded
 *         yet are skipped and reported, not treated as an error
 * Writes: people (deduped by externalIds.wikidata), source_records (one row
 *         per (title, director) claim: fieldName 'director', a Wikidata QID
 *         value, CC0 licensing -- DATA_LICENSING.md §3.1 confirms Wikidata
 *         structured data, "credits" included, is CC0 for display/store/
 *         derive/train, so this is the real, verified license, not the
 *         'unknown' placeholder the demo catalog fixture itself uses),
 *         credits (role 'director', creditOrder from the staged file,
 *         linked to its own source_records row)
 *
 * Idempotent: re-running finds existing Person rows by externalIds.wikidata
 * and skips a (titleId, personId, 'director') credit that already exists --
 * never duplicates a row. Nothing outside people/credits/source_records is
 * touched; titles/catalog data is read-only here.
 */
import 'reflect-metadata';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { DatabaseConfig } from '../config/database.config';
import { Credit } from '../entities/credit.entity';
import { Person } from '../entities/person.entity';
import { SourceRecord } from '../entities/source-record.entity';
import { Title } from '../entities/title.entity';

export interface DirectorCredit {
  wikidataId: string;
  nameEn: string | null;
  nameAr: string | null;
  creditOrder: number;
}
export interface TitleDirectorCredits {
  internalId: string;
  titleWikidataId: string;
  directors: DirectorCredit[];
}

export interface LoadDirectorCreditsSummary {
  titlesMatched: number;
  titlesNotYetLoaded: string[];
  creditsCreated: number;
  creditsAlreadyLoaded: number;
  peopleCreated: number;
}

export interface LoadDirectorCreditsOptions {
  dryRun?: boolean;
  log?: (line: string) => void;
}

async function findOrCreatePersonId(
  dataSource: DataSource,
  director: DirectorCredit,
  cache: Map<string, string>,
  dryRun: boolean,
): Promise<{ personId: string; created: boolean }> {
  const cached = cache.get(director.wikidataId);
  if (cached) {
    return { personId: cached, created: false };
  }

  const personsRepository = dataSource.getRepository(Person);
  const existing = await personsRepository
    .createQueryBuilder('person')
    .where(`person."externalIds"->>'wikidata' = :qid`, { qid: director.wikidataId })
    .getOne();
  if (existing) {
    cache.set(director.wikidataId, existing.id);
    return { personId: existing.id, created: false };
  }

  // A director's own Wikidata label may itself be missing in one language
  // (fetch-director-credits.ts already left those null rather than
  // fabricating one) -- fall back to the other language, then to the QID
  // itself, never to an invented name.
  const name = director.nameEn ?? director.nameAr ?? director.wikidataId;
  if (dryRun) {
    const placeholderId = `dry-run:${director.wikidataId}`;
    cache.set(director.wikidataId, placeholderId);
    return { personId: placeholderId, created: true };
  }
  const created = await personsRepository.save(
    personsRepository.create({ name, externalIds: { wikidata: director.wikidataId } }),
  );
  cache.set(director.wikidataId, created.id);
  return { personId: created.id, created: true };
}

export async function loadDirectorCredits(
  dataSource: DataSource,
  staged: TitleDirectorCredits[],
  options: LoadDirectorCreditsOptions = {},
): Promise<LoadDirectorCreditsSummary> {
  const dryRun = options.dryRun ?? false;
  const log = options.log ?? (() => {});
  const titlesRepository = dataSource.getRepository(Title);
  const creditsRepository = dataSource.getRepository(Credit);
  const sourceRecordsRepository = dataSource.getRepository(SourceRecord);

  const personIdCache = new Map<string, string>();
  const summary: LoadDirectorCreditsSummary = {
    titlesMatched: 0,
    titlesNotYetLoaded: [],
    creditsCreated: 0,
    creditsAlreadyLoaded: 0,
    peopleCreated: 0,
  };
  const now = new Date();

  for (const entry of staged) {
    if (entry.directors.length === 0) {
      continue;
    }

    const title = await titlesRepository.findOne({ where: { internalId: entry.internalId } });
    if (!title) {
      summary.titlesNotYetLoaded.push(entry.internalId);
      continue;
    }
    summary.titlesMatched += 1;

    for (const director of entry.directors) {
      const { personId, created: personCreated } = await findOrCreatePersonId(dataSource, director, personIdCache, dryRun);
      if (personCreated) {
        summary.peopleCreated += 1;
      }

      // A dry-run placeholder id (a director who doesn't exist as a Person
      // row yet) can never have an existing credit -- querying for one
      // would be a real UUID-column query against a fake, non-UUID string.
      // A dry-run against an *already-loaded* director still resolves to
      // its real Person id above, so this query still runs for that case,
      // correctly previewing "already loaded" rather than "would create".
      const isPlaceholderPerson = personId.startsWith('dry-run:');
      const existingCredit = isPlaceholderPerson
        ? null
        : await creditsRepository.findOne({ where: { titleId: title.id, personId, role: 'director' } });
      if (existingCredit) {
        summary.creditsAlreadyLoaded += 1;
        continue;
      }

      log(`${entry.internalId}: director ${director.nameEn ?? director.nameAr ?? director.wikidataId}`);
      if (dryRun) {
        summary.creditsCreated += 1;
        continue;
      }

      // One source_records row per (title, director) claim, matching
      // credits' own per-person granularity -- a co-directed film gets one
      // row per director, not one row listing both. Wikidata structured
      // data is CC0 (DATA_LICENSING.md §3.1): the real, verified license,
      // not the demo catalog fixture's own 'unknown' placeholder.
      const sourceRecord = await sourceRecordsRepository.save(
        sourceRecordsRepository.create({
          titleId: title.id,
          fieldName: 'director',
          value: director.wikidataId,
          source: 'wikidata',
          license: 'CC0',
          licenseStatus: 'commercial_allowed',
          allowsStorage: true,
          allowsDerivation: true,
          allowsTraining: true,
          // CC0 is a public-domain dedication -- attribution is explicitly
          // not required, unlike a CC-BY variant.
          attributionRequired: false,
          extractorVersion: 'fetch-director-credits-v1',
          reviewStatus: 'unreviewed',
          retrievedAt: now,
          validFrom: now,
        }),
      );

      await creditsRepository.save(
        creditsRepository.create({
          titleId: title.id,
          personId,
          role: 'director',
          creditOrder: director.creditOrder,
          sourceRecordId: sourceRecord.id,
        }),
      );
      summary.creditsCreated += 1;
    }
  }

  return summary;
}

function resolveStagedPath(): string {
  const packaged = path.resolve(__dirname, 'director-credits', 'catalog.demo.directors.json');
  if (existsSync(packaged)) {
    return packaged;
  }
  return path.resolve(process.cwd(), 'src', 'scripts', 'director-credits', 'catalog.demo.directors.json');
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const staged = JSON.parse(await readFile(resolveStagedPath(), 'utf8')) as TitleDirectorCredits[];

  const dataSource = new DataSource(DatabaseConfig() as DataSourceOptions);
  await dataSource.initialize();
  try {
    const summary = await loadDirectorCredits(dataSource, staged, {
      dryRun,
      log: (line) => console.log(`  ${line}`),
    });
    console.log(
      `\n${dryRun ? '[dry run] would write' : 'Wrote'} ${summary.creditsCreated} credit(s) across ${summary.titlesMatched} title(s) ` +
        `(${summary.peopleCreated} new people, ${summary.creditsAlreadyLoaded} credits already loaded, skipped).`,
    );
    if (summary.titlesNotYetLoaded.length > 0) {
      console.log(
        `${summary.titlesNotYetLoaded.length} staged title(s) have no matching row in titles yet, skipped: ` +
          summary.titlesNotYetLoaded.slice(0, 10).join(', ') +
          (summary.titlesNotYetLoaded.length > 10 ? ', ...' : ''),
      );
    }
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
