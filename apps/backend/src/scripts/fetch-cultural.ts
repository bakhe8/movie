/**
 * Cultural-context block for the demo catalog (FINGERPRINT_SCHEMA.md §3.4):
 * reads each title's Wikidata entity (the same on-disk cache as
 * fetch-catalog.ts, so a re-run is offline), the entities it references for
 * language / country / setting place / setting era, and writes `cultural`
 * on every entry of the fixture plus a coverage report per language,
 * country, slice and tier.
 *
 *   npm run catalog:cultural -- [--fixture PATH] [--force] [--only DEMO0001,DEMO0002]
 *
 * Facts only, CC0, never a model inference; nothing here touches the
 * fingerprint or the taste vector.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { CACHE_DIR, cachedGet } from './wiki-http';
import {
  CP,
  CULTURAL_EXTRACTOR_VERSION,
  buildCulturalReport,
  claimIds,
  culturalBlockFor,
  needsCultural,
  placeCountryIds,
  referencedIds,
  type CulturalEntry,
  type WdEntity,
} from './fetch-cultural.lib';

const WIKIDATA_BATCH = 50;
const DEFAULT_FIXTURE = path.resolve(__dirname, 'fixtures', 'catalog.demo.json');

async function fetchEntities(ids: string[], props: string): Promise<Record<string, WdEntity>> {
  const entities: Record<string, WdEntity> = {};
  const sorted = [...new Set(ids)].sort();
  for (let start = 0; start < sorted.length; start += WIKIDATA_BATCH) {
    const batch = sorted.slice(start, start + WIKIDATA_BATCH);
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${batch.join('|')}&props=${props}&languages=en&format=json`;
    const { status, body } = await cachedGet(url);
    if (status !== 200) {
      throw new Error(`HTTP ${status} for ${url}`);
    }
    Object.assign(entities, (JSON.parse(body) as { entities?: Record<string, WdEntity> }).entities ?? {});
  }
  return entities;
}

function parseArgs(argv: string[]): { fixture: string; force: boolean; only: Set<string> | null } {
  const args = { fixture: DEFAULT_FIXTURE, force: false, only: null as Set<string> | null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--fixture') {
      args.fixture = path.resolve(argv[++index]);
    } else if (arg === '--force') {
      args.force = true;
    } else if (arg === '--only') {
      args.only = new Set(argv[++index].split(',').map((value) => value.trim()).filter(Boolean));
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const raw = JSON.parse(await readFile(args.fixture, 'utf8')) as CulturalEntry[] | { entries: CulturalEntry[] };
  const entries = Array.isArray(raw) ? raw : raw.entries;
  const candidates = entries.filter((entry) => (!args.only || args.only.has(entry.internalId)) && needsCultural(entry, args.force));
  console.log(`cultural: ${entries.length} entries in ${path.basename(args.fixture)}; ${candidates.length} need the block (${CULTURAL_EXTRACTOR_VERSION}); cache ${CACHE_DIR}`);
  if (candidates.length > 0) {
    // 1. The films' own claims (labels are not needed here, only claims).
    const films = await fetchEntities(
      candidates.map((entry) => entry.externalIds.wikidata),
      'claims',
    );
    // 2. Everything they reference, then the countries of the setting places.
    const referencedFirst = [...new Set(candidates.flatMap((entry) => referencedIds(films[entry.externalIds.wikidata])))];
    const referenced = await fetchEntities(referencedFirst, 'labels|claims');
    const places = [...new Set(candidates.flatMap((entry) => claimIds(films[entry.externalIds.wikidata], CP.narrativeLocation)))];
    const countries = placeCountryIds(places, referenced).filter((id) => !referenced[id]);
    Object.assign(referenced, await fetchEntities(countries, 'labels|claims'));
    const now = new Date();
    for (const entry of candidates) {
      entry.cultural = culturalBlockFor(entry.externalIds.wikidata, films[entry.externalIds.wikidata], referenced, now);
    }
    console.log(`  ${candidates.length} blocks written; ${Object.keys(referenced).length} referenced entities resolved`);
  }
  const output = Array.isArray(raw) ? entries : { ...raw, entries };
  await writeFile(args.fixture, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  const reportPath = args.fixture.replace(/\.json$/, '.cultural-report.md');
  await writeFile(reportPath, buildCulturalReport(entries, new Date().toISOString().slice(0, 10), candidates.length), 'utf8');
  const withPlace = entries.filter((entry) => (entry.cultural?.settingPlaces.length ?? 0) > 0).length;
  const withEra = entries.filter((entry) => (entry.cultural?.settingEras.length ?? 0) > 0).length;
  console.log(`  ${entries.filter((entry) => entry.cultural).length} entries carry the block: ${withPlace} with a setting place, ${withEra} with an era → ${path.basename(reportPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
