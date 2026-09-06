/**
 * D1000-2: merge a `catalog.dev1000.sourced-roundN.tsv` review file (SPARQL-sourced, real-cinema
 * filtered candidates, produced by catalog-dev1000-source-round{2,3,...}.ts) into the dev1000 staging
 * file. Drops anything already reserved, resolves each survivor's enwiki sitelink title for the `wiki`
 * field, assigns contiguous internalIds, and writes STAGED_NEW records. Read-only Wikidata calls only;
 * no writes to catalog.demo.json/seed/ADMIN.
 *
 *   npx tsx src/scripts/catalog-dev1000-merge-round2.ts [sourced-file.tsv]   # default: round2
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertUniqueIdentities } from './catalog-identity';
import { buildBatchRecords, type ResolvedCandidate } from './catalog-dev1000-batch.lib';
import type { Dev1000Record } from './catalog-dev1000.lib';

const FIXTURES_DIR = join(__dirname, 'fixtures');
const USER_AGENT = 'movie-taste-cat2-dev1000/0.1 (local development staging builder)';
const DELAY_MS = 300;

interface Round2Row {
  qid: string;
  slice: string;
  regionHint: string;
  titleEn: string;
  year: number;
  imdb: string;
  tmdb: string;
  sitelinks: number;
}

function parseRound2Tsv(text: string): Round2Row[] {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim().length > 0);
  const [, ...rows] = lines;
  return rows.map((line) => {
    const [qid, slice, regionHint, titleEn, year, imdb, tmdb, sitelinks] = line.split('\t');
    return { qid, slice, regionHint, titleEn, year: Number(year), imdb, tmdb, sitelinks: Number(sitelinks) };
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchEnwikiTitle(qid: string): Promise<string | undefined> {
  const url = `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) return undefined;
  const data = (await res.json()) as { entities?: Record<string, { sitelinks?: Record<string, { title?: string }> }> };
  return data.entities?.[qid]?.sitelinks?.enwiki?.title;
}

async function main() {
  const stagingPath = join(FIXTURES_DIR, 'catalog.dev1000.staging.json');
  const staging: Dev1000Record[] = JSON.parse(readFileSync(stagingPath, 'utf8'));
  assertUniqueIdentities(staging);

  const sourceFile = process.argv[2] ?? 'catalog.dev1000.sourced-round2.tsv';
  const rows = parseRound2Tsv(readFileSync(join(FIXTURES_DIR, sourceFile), 'utf8'));
  const existingByWikidata = new Set(staging.map((r) => r.externalIds?.wikidata).filter(Boolean));
  const existingByImdb = new Set(staging.map((r) => r.externalIds?.imdb).filter(Boolean));

  const fresh = rows.filter((r) => !existingByWikidata.has(r.qid) && !existingByImdb.has(r.imdb));
  console.log(`${sourceFile}: ${rows.length} rows, already reserved: ${rows.length - fresh.length}, fresh: ${fresh.length}`);

  const resolved: ResolvedCandidate[] = [];
  const skipped: { row: Round2Row; reason: string }[] = [];
  for (const row of fresh) {
    const enwiki = await fetchEnwikiTitle(row.qid);
    if (!enwiki) {
      skipped.push({ row, reason: 'no enwiki sitelink' });
      await sleep(DELAY_MS);
      continue;
    }
    resolved.push({
      qid: row.qid,
      slice: row.slice,
      regionHint: row.regionHint,
      titleEn: row.titleEn,
      year: row.year,
      imdb: row.imdb,
      sitelinks: row.sitelinks,
      reason: row.slice,
      wiki: `en:${enwiki.replace(/ /g, '_')}`,
      tmdb: row.tmdb || undefined,
    });
    await sleep(DELAY_MS);
  }
  console.log(`resolved (has enwiki title): ${resolved.length}, skipped: ${skipped.length}`);
  for (const s of skipped) console.log(`  skip ${s.row.qid} ${s.row.titleEn} (${s.row.year}): ${s.reason}`);

  const newRecords = buildBatchRecords(staging, resolved);
  const merged = [...staging, ...newRecords].sort((a, b) => a.internalId.localeCompare(b.internalId));
  writeFileSync(stagingPath, JSON.stringify(merged, null, 2) + '\n');
  console.log(`wrote ${merged.length} total dev1000 records (${newRecords.length} new, ${staging.length} -> ${merged.length}) to ${stagingPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
