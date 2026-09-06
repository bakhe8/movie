/**
 * D1000-2 sourcing round 4: final push toward 1000. Adds countries not yet queried in round 2/3
 * (more of Africa, Central America/Caribbean, Levant/Gulf depth, Northern Europe non-English, Oceania)
 * and widens each query (limit 40, sitelinks >= 2) since smaller national cinemas otherwise return too
 * few rows. Same real-cinema gate: P495 country of origin, P345 IMDb + P4947 TMDB required, English
 * original language dropped. Writes a review TSV; does not touch staging directly.
 *
 *   npx tsx src/scripts/catalog-dev1000-source-round4.ts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES_DIR = join(__dirname, 'fixtures');
const USER_AGENT = 'movie-taste-cat2-dev1000/0.1 (local development staging builder)';
const DELAY_MS = 600;

const COUNTRY_NAMES: { name: string; hint: string; slice: string }[] = [
  { name: 'Zambia', hint: 'ZM', slice: 'africa4' },
  { name: 'Namibia', hint: 'NA', slice: 'africa4' },
  { name: 'Botswana', hint: 'BW', slice: 'africa4' },
  { name: 'Malawi', hint: 'MW', slice: 'africa4' },
  { name: 'Chad', hint: 'TD', slice: 'africa4' },
  { name: 'Niger', hint: 'NE', slice: 'africa4' },
  { name: 'Burkina Faso', hint: 'BF', slice: 'africa4' },
  { name: 'Guinea', hint: 'GN', slice: 'africa4' },
  { name: 'Benin', hint: 'BJ', slice: 'africa4' },
  { name: 'Togo', hint: 'TG', slice: 'africa4' },
  { name: 'Costa Rica', hint: 'CR', slice: 'camerica4' },
  { name: 'Panama', hint: 'PA', slice: 'camerica4' },
  { name: 'Honduras', hint: 'HN', slice: 'camerica4' },
  { name: 'El Salvador', hint: 'SV', slice: 'camerica4' },
  { name: 'Nicaragua', hint: 'NI', slice: 'camerica4' },
  { name: 'Haiti', hint: 'HT', slice: 'camerica4' },
  { name: 'Syria', hint: 'SY', slice: 'levant4' },
  { name: 'Palestine', hint: 'PS', slice: 'levant4' },
  { name: 'United Arab Emirates', hint: 'AE', slice: 'levant4' },
  { name: 'Saudi Arabia', hint: 'SA', slice: 'levant4' },
  { name: 'Kuwait', hint: 'KW', slice: 'levant4' },
  { name: 'Bahrain', hint: 'BH', slice: 'levant4' },
  { name: 'Finland', hint: 'FI', slice: 'neurope4' },
  { name: 'Cyprus', hint: 'CY', slice: 'neurope4' },
  { name: 'Malta', hint: 'MT', slice: 'neurope4' },
  { name: 'Moldova', hint: 'MD', slice: 'neurope4' },
  { name: 'Montenegro', hint: 'ME', slice: 'neurope4' },
  { name: 'Kosovo', hint: 'XK', slice: 'neurope4' },
  { name: 'Fiji', hint: 'FJ', slice: 'oceania4' },
  { name: 'Papua New Guinea', hint: 'PG', slice: 'oceania4' },
  { name: 'Brunei', hint: 'BN', slice: 'sea4' },
  { name: 'Timor-Leste', hint: 'TL', slice: 'sea4' },
  { name: 'Sudan', hint: 'SD', slice: 'africa4' },
  { name: 'Somalia', hint: 'SO', slice: 'africa4' },
  { name: 'Madagascar', hint: 'MG', slice: 'africa4' },
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveCountryQid(name: string): Promise<string | undefined> {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&type=item&format=json&limit=1`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) return undefined;
  const data = (await res.json()) as { search?: { id: string }[] };
  return data.search?.[0]?.id;
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

async function queryCountry(countryQid: string, hint: string, slice: string): Promise<Row[]> {
  const query = `
    SELECT ?film ?filmLabel ?imdb ?tmdb ?year ?sitelinks ?langLabel WHERE {
      ?film wdt:P31/wdt:P279* wd:Q11424 .
      ?film wdt:P495 wd:${countryQid} .
      ?film wdt:P345 ?imdb .
      ?film wdt:P4947 ?tmdb .
      ?film wdt:P577 ?date .
      BIND(YEAR(?date) AS ?year)
      ?film wikibase:sitelinks ?sitelinks .
      FILTER(?sitelinks >= 2)
      OPTIONAL { ?film wdt:P364 ?lang }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    ORDER BY DESC(?sitelinks)
    LIMIT 40
  `;
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json' } });
  if (!res.ok) {
    console.log(`  ${hint}: query failed (${res.status})`);
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
      slice,
      regionHint: hint,
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
  for (const country of COUNTRY_NAMES) {
    const qid = await resolveCountryQid(country.name);
    await sleep(300);
    if (!qid) {
      console.log(`  ${country.hint}: could not resolve QID for "${country.name}"`);
      continue;
    }
    const rows = await queryCountry(qid, country.hint, country.slice);
    console.log(`  ${country.hint} (${country.name} = ${qid}): ${rows.length} raw`);
    all.push(...rows);
    await sleep(DELAY_MS);
  }
  console.log(`total raw: ${all.length}`);

  const filtered = all.filter((r) => r.lang.toLowerCase() !== 'english' && r.imdb && r.tmdb);
  console.log(`after English-original-language + imdb/tmdb-presence filter: ${filtered.length} (dropped ${all.length - filtered.length})`);

  const byQid = new Map<string, Row>();
  for (const r of filtered) if (!byQid.has(r.qid)) byQid.set(r.qid, r);
  const deduped = [...byQid.values()];
  console.log(`after cross-slice de-dupe: ${deduped.length}`);

  const header = ['qid', 'slice', 'region_hint', 'title_en', 'year', 'imdb', 'tmdb', 'sitelinks'].join('\t');
  const lines = deduped.map((r) => [r.qid, r.slice, r.regionHint, r.titleEn, r.year, r.imdb, r.tmdb, r.sitelinks].join('\t'));
  const outPath = join(FIXTURES_DIR, 'catalog.dev1000.sourced-round4.tsv');
  writeFileSync(outPath, [header, ...lines].join('\n') + '\n');
  console.log(`wrote ${deduped.length} rows to ${outPath} (review artifact, not yet merged into staging)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
