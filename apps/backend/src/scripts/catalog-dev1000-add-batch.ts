/**
 * D1000-2: resolve `catalog.expansion.candidates.tsv` against Wikidata (P4947 TMDB id, P345 IMDb
 * confirmation, enwiki sitelink title), drop anything already reserved in the 425 baseline or the
 * dev1000 staging file, and append the rest as STAGED_NEW dev1000 records starting at DEMO0426.
 *
 *   npx tsx src/scripts/catalog-dev1000-add-batch.ts
 *
 * Network: read-only Wikidata Special:EntityData fetches, 250ms apart. No writes to any external
 * service. Does not touch catalog.demo.json, seed, release or ADMIN.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertUniqueIdentities } from './catalog-identity';
import { buildBatchRecords, dedupeCandidates, parseCandidatesTsv, type ResolvedCandidate } from './catalog-dev1000-batch.lib';
import type { Dev1000Record } from './catalog-dev1000.lib';

const FIXTURES_DIR = join(__dirname, 'fixtures');
const USER_AGENT = 'movie-taste-cat2-dev1000/0.1 (local development staging builder)';
const DELAY_MS = 250;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveOne(candidate: ReturnType<typeof parseCandidatesTsv>[number]): Promise<ResolvedCandidate | { skip: string; candidate: typeof candidate }> {
  const res = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${candidate.qid}.json`, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) return { skip: `wikidata fetch failed (${res.status})`, candidate };
  const data = (await res.json()) as { entities?: Record<string, { claims?: Record<string, { mainsnak?: { datavalue?: { value?: string } } }[]>; sitelinks?: Record<string, { title?: string }> }> };
  const entity = data.entities?.[candidate.qid];
  if (!entity) return { skip: 'wikidata entity missing', candidate };
  const claims = entity.claims ?? {};
  const imdbClaim: string | undefined = claims.P345?.[0]?.mainsnak?.datavalue?.value;
  const tmdbClaim: string | undefined = claims.P4947?.[0]?.mainsnak?.datavalue?.value;
  const enwiki: string | undefined = entity.sitelinks?.enwiki?.title;
  if (!imdbClaim) return { skip: 'no P345 (imdb) on wikidata item', candidate };
  const imdbMismatch = imdbClaim !== candidate.imdb ? `Wikidata P345 (${imdbClaim}) disagrees with the pool imdb id (${candidate.imdb}); kept pool value, flagged for manual recheck.` : undefined;
  const wiki = enwiki ? `en:${enwiki.replace(/ /g, '_')}` : `wikidata:${candidate.qid}`;
  return { ...candidate, wiki, tmdb: tmdbClaim, imdbMismatch };
}

async function main() {
  const stagingPath = join(FIXTURES_DIR, 'catalog.dev1000.staging.json');
  const staging: Dev1000Record[] = JSON.parse(readFileSync(stagingPath, 'utf8'));
  assertUniqueIdentities(staging);
  if (staging.length !== 425) throw new Error(`expected 425 baseline dev1000 records before adding a batch, found ${staging.length}`);

  const candidatesTsv = readFileSync(join(FIXTURES_DIR, 'catalog.expansion.candidates.tsv'), 'utf8');
  const candidates = parseCandidatesTsv(candidatesTsv);
  const dedupe = dedupeCandidates(staging, candidates);
  console.log(`candidates: ${candidates.length}, already reserved: ${dedupe.droppedAsExisting.length}, duplicate within pool: ${dedupe.droppedAsDuplicateWithinBatch.length}, fresh: ${dedupe.fresh.length}`);

  const resolved: ResolvedCandidate[] = [];
  const skipped: { candidate: (typeof candidates)[number]; reason: string }[] = [];
  for (const candidate of dedupe.fresh) {
    const result = await resolveOne(candidate);
    if ('skip' in result) skipped.push({ candidate: result.candidate, reason: result.skip });
    else resolved.push(result);
    await sleep(DELAY_MS);
  }
  console.log(`resolved: ${resolved.length}, skipped (no reliable wikidata bridge): ${skipped.length}`);
  for (const s of skipped) console.log(`  skip ${s.candidate.qid} ${s.candidate.titleEn} (${s.candidate.year}): ${s.reason}`);

  const newRecords = buildBatchRecords(staging, resolved);
  const merged = [...staging, ...newRecords].sort((a, b) => a.internalId.localeCompare(b.internalId));
  writeFileSync(stagingPath, JSON.stringify(merged, null, 2) + '\n');
  console.log(`wrote ${merged.length} total dev1000 records (${newRecords.length} new) to ${stagingPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
