/**
 * D1000-2 sourcing round 3: extends round 2's country-slice SPARQL sourcing to more under-represented
 * countries (round 2 covered NG/SN/GH/ZA/CM, CO/CL/PE/CU/BO, PH/TH/VN/MY/KH, PK/BD/LK, CZ/RO/GE/UA/RS/HR).
 * Resolves each country name to its Wikidata QID via wbsearchentities first (safer than hard-coding
 * QIDs from memory), then runs the same P495 + P345 + P4947 + real-cinema (non-English-original)
 * query used in round 2. Writes a review TSV; does not touch staging directly.
 *
 *   npx tsx src/scripts/catalog-dev1000-source-round3.ts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES_DIR = join(__dirname, 'fixtures');
const USER_AGENT = 'movie-taste-cat2-dev1000/0.1 (local development staging builder)';
const DELAY_MS = 600;

const COUNTRY_NAMES: { name: string; hint: string; slice: string }[] = [
  { name: "Côte d'Ivoire", hint: 'CI', slice: 'africa3' },
  { name: 'Tanzania', hint: 'TZ', slice: 'africa3' },
  { name: 'Uganda', hint: 'UG', slice: 'africa3' },
  { name: 'Zimbabwe', hint: 'ZW', slice: 'africa3' },
  { name: 'Mozambique', hint: 'MZ', slice: 'africa3' },
  { name: 'Angola', hint: 'AO', slice: 'africa3' },
  { name: 'Mali', hint: 'ML', slice: 'africa3' },
  { name: 'Rwanda', hint: 'RW', slice: 'africa3' },
  { name: 'Uruguay', hint: 'UY', slice: 'latam3' },
  { name: 'Ecuador', hint: 'EC', slice: 'latam3' },
  { name: 'Venezuela', hint: 'VE', slice: 'latam3' },
  { name: 'Paraguay', hint: 'PY', slice: 'latam3' },
  { name: 'Dominican Republic', hint: 'DO', slice: 'latam3' },
  { name: 'Guatemala', hint: 'GT', slice: 'latam3' },
  { name: 'Puerto Rico', hint: 'PR', slice: 'latam3' },
  { name: 'Nepal', hint: 'NP', slice: 'sasia3' },
  { name: 'Bhutan', hint: 'BT', slice: 'sasia3' },
  { name: 'Mongolia', hint: 'MN', slice: 'casia3' },
  { name: 'Myanmar', hint: 'MM', slice: 'sea3' },
  { name: 'Laos', hint: 'LA', slice: 'sea3' },
  { name: 'Indonesia', hint: 'ID', slice: 'sea3' },
  { name: 'Bulgaria', hint: 'BG', slice: 'eeurope3' },
  { name: 'Slovakia', hint: 'SK', slice: 'eeurope3' },
  { name: 'Slovenia', hint: 'SI', slice: 'eeurope3' },
  { name: 'Armenia', hint: 'AM', slice: 'eeurope3' },
  { name: 'Azerbaijan', hint: 'AZ', slice: 'eeurope3' },
  { name: 'Belarus', hint: 'BY', slice: 'eeurope3' },
  { name: 'Lithuania', hint: 'LT', slice: 'eeurope3' },
  { name: 'Latvia', hint: 'LV', slice: 'eeurope3' },
  { name: 'Estonia', hint: 'EE', slice: 'eeurope3' },
  { name: 'North Macedonia', hint: 'MK', slice: 'eeurope3' },
  { name: 'Bosnia and Herzegovina', hint: 'BA', slice: 'eeurope3' },
  { name: 'Albania', hint: 'AL', slice: 'eeurope3' },
  { name: 'Jordan', hint: 'JO', slice: 'gulf3' },
  { name: 'Lebanon', hint: 'LB', slice: 'gulf3' },
  { name: 'Iraq', hint: 'IQ', slice: 'gulf3' },
  { name: 'Yemen', hint: 'YE', slice: 'gulf3' },
  { name: 'Oman', hint: 'OM', slice: 'gulf3' },
  { name: 'Qatar', hint: 'QA', slice: 'gulf3' },
  { name: 'Kazakhstan', hint: 'KZ', slice: 'casia3' },
  { name: 'Kyrgyzstan', hint: 'KG', slice: 'casia3' },
  { name: 'Tajikistan', hint: 'TJ', slice: 'casia3' },
  { name: 'Turkmenistan', hint: 'TM', slice: 'casia3' },
  { name: 'Uzbekistan', hint: 'UZ', slice: 'casia3' },
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
      FILTER(?sitelinks >= 3)
      OPTIONAL { ?film wdt:P364 ?lang }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    ORDER BY DESC(?sitelinks)
    LIMIT 30
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
  const outPath = join(FIXTURES_DIR, 'catalog.dev1000.sourced-round3.tsv');
  writeFileSync(outPath, [header, ...lines].join('\n') + '\n');
  console.log(`wrote ${deduped.length} rows to ${outPath} (review artifact, not yet merged into staging)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
