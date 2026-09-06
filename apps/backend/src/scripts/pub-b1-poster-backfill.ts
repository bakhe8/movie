/**
 * PUB-B1 (ADR-118): closes the public-v1 shadow report's one open gap --
 * POSTER_MISSING -- for exactly the titles it names, nothing else. No
 * cutover, no grandfathering an unresolved title (board rule): each one
 * gets a definite outcome, recorded, never a guessed value.
 *
 * Per title with a TMDB id, `GET /movie/{id}` through `cachedGet` (already
 * retries 429/5xx/network, honours Retry-After, caches 200/404 to disk):
 *   - a poster path: written to the fixture entry, `titles.posterPath`, and
 *     a `source_records` row (same shape as `load-catalog-rights.ts`'s
 *     `tmdbPosterRow`, idempotent by this script's own extractorVersion);
 *   - TMDB answers 200 with `poster_path: null`: left NULL, not written --
 *     a confirmed absence, not a failure, never a fabricated value;
 *   - a definite 404: left blocked, recorded as a confirmed blocker;
 *   - no TMDB id at all: out of this script's reach, recorded as such;
 *   - retries exhausted (network/429/5xx): recorded so a re-run retries it
 *     -- this script is idempotent, a re-run only touches what is still
 *     POSTER_MISSING.
 *
 * Reimplements the TMDB call and rights-registry row shape standalone
 * (`pub-b1-poster-backfill.lib.ts`) rather than importing
 * `fetch-tmdb-posters.ts`/`load-catalog-rights.ts`, which had uncommitted
 * edits in flight from another session when this ran.
 *
 *   cd apps/backend && npx tsx src/scripts/pub-b1-poster-backfill.ts [--dry-run]
 */
import 'reflect-metadata';
import { config } from 'dotenv';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import path from 'node:path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { DatabaseConfig } from '../config/database.config';
import { SourceRecord } from '../entities/source-record.entity';
import { Title } from '../entities/title.entity';
import { PublicationPolicyService } from '../modules/publication/publication-policy.service';
import { PublicationPreviewService } from '../modules/publication/publication-preview.service';
import { cachedGet } from './wiki-http';
import { EXTRACTOR_VERSION, parseTmdbPosterPath, tmdbPosterSourceRecordRow } from './pub-b1-poster-backfill.lib';

config({ path: resolve(process.cwd(), '../../.env') });

const FIXTURE = path.resolve(__dirname, 'fixtures', 'catalog.demo.json');
const REPORT = path.resolve(__dirname, 'pub-b1-poster-backfill-report.md');

type Outcome = 'resolved' | 'tmdb_confirmed_no_poster' | 'tmdb_404' | 'no_tmdb_id' | 'request_failed';

interface FixtureEntry {
  internalId: string;
  posterPath?: string | null;
  [key: string]: unknown;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const readToken = process.env.TMDB_READ_ACCESS_TOKEN;
  const apiKey = process.env.TMDB_API_KEY;
  if (!readToken && !apiKey) {
    console.error('TMDB_READ_ACCESS_TOKEN or TMDB_API_KEY is required (root .env)');
    process.exit(2);
  }

  const dataSource = new DataSource(DatabaseConfig() as DataSourceOptions);
  await dataSource.initialize();

  try {
    const titlesRepository = dataSource.getRepository(Title);
    const sourceRecordsRepository = dataSource.getRepository(SourceRecord);
    const preview = new PublicationPreviewService(titlesRepository, sourceRecordsRepository, new PublicationPolicyService());

    const before = await preview.shadowReport();
    const candidates = before.titles.filter((t) => t.blockerCodes.includes('POSTER_MISSING'));
    console.log(`pub-b1 poster backfill: ${candidates.length} titles flagged POSTER_MISSING (of ${before.totalTitles})${dryRun ? ' [--dry-run]' : ''}`);

    const rawParsed = JSON.parse(await readFile(FIXTURE, 'utf8')) as FixtureEntry[] | { entries: FixtureEntry[] };
    const fixtureEntries = Array.isArray(rawParsed) ? rawParsed : rawParsed.entries;
    const fixtureByInternalId = new Map(fixtureEntries.map((entry) => [entry.internalId, entry]));

    const results: { internalId: string; outcome: Outcome }[] = [];
    let fixtureChanged = false;

    for (const candidate of candidates) {
      const title = await titlesRepository.findOneOrFail({ where: { id: candidate.titleId } });
      const tmdbId = title.externalIds?.tmdb;
      if (!tmdbId) {
        results.push({ internalId: title.internalId, outcome: 'no_tmdb_id' });
        continue;
      }

      const base = `https://api.themoviedb.org/3/movie/${encodeURIComponent(tmdbId)}`;
      const url = readToken ? base : `${base}?api_key=${apiKey}`;
      let status: number;
      let body: string;
      try {
        ({ status, body } = await cachedGet(url, readToken ? { Authorization: `Bearer ${readToken}` } : {}));
      } catch {
        results.push({ internalId: title.internalId, outcome: 'request_failed' });
        continue;
      }

      if (status === 404) {
        results.push({ internalId: title.internalId, outcome: 'tmdb_404' });
        continue;
      }
      if (status !== 200) {
        results.push({ internalId: title.internalId, outcome: 'request_failed' });
        continue;
      }

      const posterPath = parseTmdbPosterPath(body);
      if (!posterPath) {
        results.push({ internalId: title.internalId, outcome: 'tmdb_confirmed_no_poster' });
        continue;
      }

      if (!dryRun) {
        const fixtureEntry = fixtureByInternalId.get(title.internalId);
        if (fixtureEntry) {
          fixtureEntry.posterPath = posterPath;
          fixtureChanged = true;
        }

        const existing = await sourceRecordsRepository.findOne({
          where: { titleId: title.id, fieldName: 'posterPath', source: 'tmdb', extractorVersion: EXTRACTOR_VERSION },
        });
        if (!existing) {
          await sourceRecordsRepository.insert({
            ...tmdbPosterSourceRecordRow(posterPath),
            titleId: title.id,
            extractorVersion: EXTRACTOR_VERSION,
            reviewStatus: 'unreviewed',
            retrievedAt: new Date(),
            validFrom: new Date(),
          });
        }

        await titlesRepository.update({ id: title.id }, { posterPath });
      }
      results.push({ internalId: title.internalId, outcome: 'resolved' });
    }

    if (fixtureChanged && !dryRun) {
      const output = Array.isArray(rawParsed) ? fixtureEntries : { ...rawParsed, entries: fixtureEntries };
      await writeFile(FIXTURE, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    }

    const after = dryRun ? before : await preview.shadowReport();
    const counts = results.reduce<Partial<Record<Outcome, number>>>((acc, r) => {
      acc[r.outcome] = (acc[r.outcome] ?? 0) + 1;
      return acc;
    }, {});

    console.log(
      `resolved ${counts.resolved ?? 0}/${candidates.length}; before ready=${before.readyCount}/${before.totalTitles}, after ready=${after.readyCount}/${after.totalTitles}`,
    );

    const lines = [
      '# PUB-B1 — poster backfill result',
      '',
      `Generated by \`src/scripts/pub-b1-poster-backfill.ts\`${dryRun ? ' (--dry-run: nothing written)' : ''} on ${new Date().toISOString().slice(0, 10)}.`,
      '',
      `- Candidates (POSTER_MISSING before this run): ${candidates.length}`,
      `- resolved (fixture + source_records + titles.posterPath written): ${counts.resolved ?? 0}`,
      `- tmdb_confirmed_no_poster (TMDB answered 200, poster_path null -- left blocked, not fabricated): ${counts.tmdb_confirmed_no_poster ?? 0}`,
      `- tmdb_404 (confirmed blocker per PUB-B1's rule): ${counts.tmdb_404 ?? 0}`,
      `- no_tmdb_id (out of this script's reach): ${counts.no_tmdb_id ?? 0}`,
      `- request_failed (retries exhausted by \`cachedGet\`; re-run to retry): ${counts.request_failed ?? 0}`,
      '',
      `- Ready before: ${before.readyCount}/${before.totalTitles} -> after: ${after.readyCount}/${after.totalTitles}`,
      '',
      '## Per-title outcome',
      '',
      ...results.map((r) => `- ${r.internalId}: ${r.outcome}`),
      '',
    ];
    await writeFile(REPORT, `${lines.join('\n')}\n`, 'utf8');
    console.log(`saved -> ${path.basename(REPORT)}`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
