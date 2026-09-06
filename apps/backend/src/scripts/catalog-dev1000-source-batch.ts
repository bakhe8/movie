/**
 * D1000-2 sourcing round 2: the pre-vetted `catalog.expansion.candidates.tsv` pool (125 rows) turned
 * out to already be fully consumed by the 425 baseline (verified by catalog-dev1000-add-batch.ts --
 * every row matched an existing internalId by wikidata QID). This script runs a fresh Wikidata SPARQL
 * sourcing pass over the same under-represented country slices from catalog.expansion.criteria.md,
 * excludes anything already reserved, applies the same real-cinema filter (drop P364=English, since
 * every slice here is a non-English-speaking country and an English original-language film credited
 * to it is almost always a service/tax co-production, mirroring the manual check criteria.md § point 2
 * describes) and an IMDb-presence gate, then writes a plain review TSV (not yet merged into staging) so
 * the batch can be spot-checked before D1000-2 assigns internalIds.
 *
 *   npx tsx src/scripts/catalog-dev1000-source-batch.ts
 *
 * Network: read-only query.wikidata.org SPARQL, ~600ms apart. Writes only
 * catalog.dev1000.sourced-round2.tsv (review artifact, not a staging commit).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES_DIR = join(__dirname, 'fixtures');
const USER_AGENT = 'movie-taste-cat2-dev1000/0.1 (local development staging builder)';
const DELAY_MS = 600;

// Country of origin (P495) targets for the gap slices identified in catalog.expansion.criteria.md,
// re-run because the original 125-row pool from that pass is now fully inside the 425 baseline.
const COUNTRIES: { qid: string; hint: string; slice: string }[] = [
  { qid: 'Q1033', hint: 'NG', slice: 'africa2' },
  { qid: 'Q1041', hint: 'SN', slice: 'africa2' },
  { qid: 'Q117', hint: 'GH', slice: 'africa2' },
  { qid: 'Q258', hint: 'ZA', slice: 'africa2' },
  { qid: 'Q1009', hint: 'CM', slice: 'africa2' },
  { qid: 'Q739', hint: 'CO', slice: 'latam2' },
  { qid: 'Q298', hint: 'CL', slice: 'latam2' },
  { qid: 'Q419', hint: 'PE', slice: 'latam2' },
  { qid: 'Q241', hint: 'CU', slice: 'latam2' },
  { qid: 'Q750', hint: 'BO', slice: 'latam2' },
  { qid: 'Q928', hint: 'PH', slice: 'sea2' },
  { qid: 'Q869', hint: 'TH', slice: 'sea2' },
  { qid: 'Q881', hint: 'VN', slice: 'sea2' },
  { qid: 'Q833', hint: 'MY', slice: 'sea2' },
  { qid: 'Q424', hint: 'KH', slice: 'sea2' },
  { qid: 'Q843', hint: 'PK', slice: 'sasia2' },
  { qid: 'Q902', hint: 'BD', slice: 'sasia2' },
  { qid: 'Q854', hint: 'LK', slice: 'sasia2' },
  { qid: 'Q213', hint: 'CZ', slice: 'eeurope2' },
  { qid: 'Q218', hint: 'RO', slice: 'eeurope2' },
  { qid: 'Q230', hint: 'GE', slice: 'eeurope2' },
  { qid: 'Q212', hint: 'UA', slice: 'eeurope2' },
  { qid: 'Q403', hint: 'RS', slice: 'eeurope2' },
  { qid: 'Q224', hint: 'HR', slice: 'eeurope2' },
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Row {
  qid: string;
  slice: string;
  regionHint: string;
  titleEn: string;
  year: number;
  imdb: string;
  tmdb: string;
  sitelinks: number;
  lang: string;
}

async function queryCountry(country: (typeof COUNTRIES)[number]): Promise<Row[]> {
  const query = `
    SELECT ?film ?filmLabel ?imdb ?tmdb ?year ?sitelinks ?langLabel WHERE {
      ?film wdt:P31/wdt:P279* wd:Q11424 .
      ?film wdt:P495 wd:${country.qid} .
      ?film wdt:P345 ?imdb .
      ?film wdt:P4947 ?tmdb .
      ?film wdt:P577 ?date .
      BIND(YEAR(?date) AS ?year)
      ?film wikibase:sitelinks ?sitelinks .
      FILTER(?sitelinks >= 4)
      OPTIONAL { ?film wdt:P364 ?lang }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    ORDER BY DESC(?sitelinks)
    LIMIT 25
  `;
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json' } });
  if (!res.ok) {
    console.log(`  ${country.hint}: query failed (${res.status})`);
    return [];
  }
  const data = (await res.json()) as { results: { bindings: Record<string, { value: string }>[] } };
  const seen = new Set<string>();
  const rows: Row[] = [];
  for (const b of data.results.bindings) {
    const qid = b.film.value.replace('http://www.wikidata.org/entity/', '');
    if (seen.has(qid)) continue;
    seen.add(qid);
    rows.push({
      qid,
      slice: country.slice,
      regionHint: country.hint,
      titleEn: b.filmLabel?.value ?? qid,
      year: Number(b.year?.value),
      imdb: b.imdb?.value,
      tmdb: b.tmdb?.value,
      sitelinks: Number(b.sitelinks?.value ?? 0),
      lang: b.langLabel?.value ?? '',
    });
  }
  return rows;
}

async function main() {
  const all: Row[] = [];
  for (const country of COUNTRIES) {
    const rows = await queryCountry(country);
    console.log(`  ${country.hint} (${country.slice}): ${rows.length} raw`);
    all.push(...rows);
    await sleep(DELAY_MS);
  }
  console.log(`total raw: ${all.length}`);

  // Real-cinema filter: an English-original-language film "of" a non-English-speaking country in
  // this list is almost always a tax/service co-production credit, not a genuine national work
  // (criteria.md point 2). Every country queried here is non-English-speaking, so drop lang=English.
  const filtered = all.filter((r) => r.lang.toLowerCase() !== 'english');
  console.log(`after English-original-language filter: ${filtered.length} (dropped ${all.length - filtered.length})`);

  // De-dupe across slices (a film can share a co-production credit across two queried countries).
  const byQid = new Map<string, Row>();
  for (const r of filtered) if (!byQid.has(r.qid)) byQid.set(r.qid, r);
  const deduped = [...byQid.values()];
  console.log(`after cross-slice de-dupe: ${deduped.length}`);

  const header = ['qid', 'slice', 'region_hint', 'title_en', 'year', 'imdb', 'tmdb', 'sitelinks'].join('\t');
  const lines = deduped.map((r) => [r.qid, r.slice, r.regionHint, r.titleEn, r.year, r.imdb, r.tmdb, r.sitelinks].join('\t'));
  const outPath = join(FIXTURES_DIR, 'catalog.dev1000.sourced-round2.tsv');
  writeFileSync(outPath, [header, ...lines].join('\n') + '\n');
  console.log(`wrote ${deduped.length} rows to ${outPath} (review artifact, not yet merged into staging)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
