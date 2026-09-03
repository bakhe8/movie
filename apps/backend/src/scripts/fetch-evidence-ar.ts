/**
 * Arabic plot evidence for the demo catalog (FINGERPRINT_SCHEMA.md §5,
 * DEMO_DATA_PLAN §7.5): for every entry with an Arabic Wikipedia article, read
 * the article's plot section (same rule as the English plot in
 * fetch-catalog.ts) and store it as `evidence.plotSummaryAr` / `plotSourceAr`.
 * The enrichment runner appends it to the English plot when that text is
 * short — the gap the coverage report showed on the Arabic slice.
 *
 *   npm run catalog:evidence-ar -- [--fixture PATH] [--force] [--only DEMO0001,DEMO0002]
 *
 * Fixture-only evidence (never persisted to the database), licensed like the
 * English plot text (CC BY-SA, derived from, not displayed).
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { CACHE_DIR, getJson } from './wiki-http';
import { arabicPlotEvidence } from './wiki-plot.lib';

const DEFAULT_FIXTURE = path.resolve(__dirname, 'fixtures', 'catalog.demo.json');

interface Entry {
  internalId: string;
  titleEn: string;
  slice?: string;
  evidence: {
    plotSummary: string | null;
    plotSource: string | null;
    plotSummaryAr?: string | null;
    plotSourceAr?: string | null;
    wikipedia: { en?: string; ar?: string };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface WikiExtractResponse {
  query?: { pages?: { title: string; missing?: boolean; extract?: string }[] };
}

// Identical URL shape to fetch-catalog.ts's fetchExtract, so the articles it
// already read for the plot fallback are cache hits here.
async function fetchExtract(lang: string, title: string): Promise<string | null> {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=wiki&redirects=1&titles=${encodeURIComponent(title)}&format=json&formatversion=2`;
  const result = await getJson<WikiExtractResponse>(url);
  const page = result?.query?.pages?.[0];
  return !page || page.missing || !page.extract ? null : page.extract;
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
  const raw = JSON.parse(await readFile(args.fixture, 'utf8')) as Entry[] | { entries: Entry[] };
  const entries = Array.isArray(raw) ? raw : raw.entries;
  const candidates = entries.filter(
    (entry) => entry.evidence?.wikipedia?.ar && (!args.only || args.only.has(entry.internalId)) && (args.force || entry.evidence.plotSummaryAr === undefined),
  );
  console.log(`evidence-ar: ${entries.length} entries in ${path.basename(args.fixture)}; ${candidates.length} with an arwiki article to read; cache ${CACHE_DIR}`);
  let found = 0;
  for (const entry of candidates) {
    const article = entry.evidence.wikipedia.ar!;
    const evidence = arabicPlotEvidence(article, await fetchExtract('ar', article));
    entry.evidence.plotSummaryAr = evidence.plotSummaryAr;
    entry.evidence.plotSourceAr = evidence.plotSourceAr;
    found += evidence.plotSummaryAr ? 1 : 0;
  }
  const output = Array.isArray(raw) ? entries : { ...raw, entries };
  await writeFile(args.fixture, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  const withAr = entries.filter((entry) => entry.evidence?.plotSummaryAr).length;
  const shortEn = entries.filter((entry) => entry.evidence?.plotSummaryAr && (entry.evidence.plotSummary?.length ?? 0) < 2000).length;
  console.log(`  ${found} of ${candidates.length} articles have a plot section; ${withAr} entries now carry Arabic plot evidence, ${shortEn} of them beside an English plot under 2,000 characters`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
