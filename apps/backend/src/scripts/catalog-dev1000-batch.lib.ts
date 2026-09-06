import { assertUniqueIdentities, type SourceReservation } from './catalog-identity';
import type { Dev1000Record } from './catalog-dev1000.lib';

export interface CandidateRow {
  qid: string;
  slice: string;
  regionHint: string;
  titleEn: string;
  year: number;
  imdb: string;
  sitelinks: number;
  reason: string;
}

/** Parses the tab-separated expansion candidate pool (header: qid,slice,region_hint,title_en,year,imdb,sitelinks,reason). */
export function parseCandidatesTsv(text: string): CandidateRow[] {
  const lines = text
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim().length > 0);
  const [header, ...rows] = lines;
  const cols = header.split('\t');
  const expected = ['qid', 'slice', 'region_hint', 'title_en', 'year', 'imdb', 'sitelinks', 'reason'];
  if (cols.join(',') !== expected.join(',')) throw new Error(`unexpected candidates.tsv header: ${header}`);
  return rows.map((line) => {
    const [qid, slice, regionHint, titleEn, year, imdb, sitelinks, reason] = line.split('\t');
    return { qid, slice, regionHint, titleEn, year: Number(year), imdb, sitelinks: Number(sitelinks), reason };
  });
}

export interface DedupeResult {
  fresh: CandidateRow[];
  droppedAsExisting: { candidate: CandidateRow; existingInternalId: string }[];
  droppedAsDuplicateWithinBatch: CandidateRow[];
}

/** Drops any candidate whose Wikidata QID or IMDb id is already reserved, or repeats within the pool itself. */
export function dedupeCandidates(existing: readonly SourceReservation[], candidates: readonly CandidateRow[]): DedupeResult {
  const existingByWikidata = new Map(existing.filter((row) => row.externalIds?.wikidata).map((row) => [row.externalIds!.wikidata!, row.internalId]));
  const existingByImdb = new Map(existing.filter((row) => row.externalIds?.imdb).map((row) => [row.externalIds!.imdb!, row.internalId]));

  const fresh: CandidateRow[] = [];
  const droppedAsExisting: DedupeResult['droppedAsExisting'] = [];
  const droppedAsDuplicateWithinBatch: CandidateRow[] = [];
  const seenWikidata = new Set<string>();
  const seenImdb = new Set<string>();

  for (const candidate of candidates) {
    const existingInternalId = existingByWikidata.get(candidate.qid) ?? existingByImdb.get(candidate.imdb);
    if (existingInternalId) {
      droppedAsExisting.push({ candidate, existingInternalId });
      continue;
    }
    if (seenWikidata.has(candidate.qid) || seenImdb.has(candidate.imdb)) {
      droppedAsDuplicateWithinBatch.push(candidate);
      continue;
    }
    seenWikidata.add(candidate.qid);
    seenImdb.add(candidate.imdb);
    fresh.push(candidate);
  }
  return { fresh, droppedAsExisting, droppedAsDuplicateWithinBatch };
}

/** Next internalId(s) after the highest currently reserved DEMOxxxx, contiguous, zero gaps. */
export function nextInternalIds(existing: readonly SourceReservation[], count: number): string[] {
  const numbers = existing.map((row) => Number(row.internalId.replace(/\D/g, ''))).filter((n) => !Number.isNaN(n));
  const max = numbers.length ? Math.max(...numbers) : 0;
  return Array.from({ length: count }, (_, i) => `DEMO${String(max + 1 + i).padStart(4, '0')}`);
}

export interface ResolvedCandidate extends CandidateRow {
  wiki: string;
  tmdb?: string;
  imdbMismatch?: string;
}

/** Assembles a batch of Dev1000Record rows from resolved candidates; validates against the reserved set before returning. */
export function buildBatchRecords(existing: readonly Dev1000Record[], resolved: readonly ResolvedCandidate[]): Dev1000Record[] {
  const ids = nextInternalIds(existing, resolved.length);
  const records: Dev1000Record[] = resolved.map((row, i) => ({
    internalId: ids[i],
    wiki: row.wiki,
    titleEn: row.titleEn,
    year: row.year,
    externalIds: { wikidata: row.qid, imdb: row.imdb, ...(row.tmdb ? { tmdb: row.tmdb } : {}) },
    devStatus: 'STAGED_NEW',
    ...(row.imdbMismatch ? { blockReason: row.imdbMismatch } : {}),
  }));
  assertUniqueIdentities([...existing, ...records]);
  return records;
}
