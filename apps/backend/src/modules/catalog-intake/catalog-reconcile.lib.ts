import { catalogEntryToTitle, type CatalogEntry } from '../../scripts/seed-demo.lib';
import { ID_PROVIDERS } from '../../scripts/catalog-identity';

// CAT-J1 / J1a (ADR-121): the `catalog_reconcile` report, pure and
// read-only. The release fixture (`catalog.demo.json`) and `titles` are two
// copies of the same 389 works that drift independently -- PUB-B1 wrote
// `posterPath` into both, admin edits land only in the database, a fixture
// rebuild lands only in Git until the next seed. This lists every field
// where they disagree so a person decides which side is right; it repairs
// nothing (a repair is either a seed run or an audited admin write, never a
// job that silently picks a side).

export interface ReconcileTitleRow {
  internalId: string;
  titleEn: string | null;
  titleAr: string | null;
  description: string | null;
  releaseYear: number | null;
  genres: string[] | null;
  originalLanguage: string | null;
  posterPath: string | null;
  externalIds: { wikidata?: string; imdb?: string; tmdb?: string } | null;
}

export const RECONCILED_FIELDS = ['titleEn', 'titleAr', 'description', 'releaseYear', 'genres', 'originalLanguage', 'posterPath'] as const;
type ReconciledField = (typeof RECONCILED_FIELDS)[number] | `externalIds.${(typeof ID_PROVIDERS)[number]}`;

export interface FieldDrift {
  internalId: string;
  field: ReconciledField;
  fixture: unknown;
  database: unknown;
}

export interface CatalogReconcileReport {
  fixtureEntries: number;
  titlesExamined: number;
  matched: number;
  /** In the fixture, not in `titles` -- never seeded, or seeded under another id. */
  fixtureOnly: string[];
  /** In `titles`, not in the fixture -- the 15 FILM seeds, admin-created rows, or a fixture that lost an entry. */
  databaseOnly: string[];
  driftByField: Partial<Record<ReconciledField, number>>;
  /** Up to `driftLimit` individual differences. */
  drift: FieldDrift[];
  driftTotal: number;
}

function normalize(value: unknown): unknown {
  if (value === undefined || value === '') return null;
  if (Array.isArray(value)) return value.length === 0 ? null : [...value].map(String).sort().join(',');
  return value;
}

/**
 * Compares what a seed run WOULD write (`catalogEntryToTitle`, so the
 * fixture side is read with the seed's own rules, e.g. the Arabic lead
 * standing in for a Wikidata stub description) against what `titles` holds.
 */
export function reconcileCatalog(fixture: readonly CatalogEntry[], titles: readonly ReconcileTitleRow[], driftLimit = 200): CatalogReconcileReport {
  const byId = new Map(titles.map((row) => [row.internalId, row]));
  const fixtureIds = new Set(fixture.map((entry) => entry.internalId));
  const drift: FieldDrift[] = [];
  const driftByField: Partial<Record<ReconciledField, number>> = {};
  let driftTotal = 0;
  let matched = 0;

  const note = (internalId: string, field: ReconciledField, fixtureValue: unknown, databaseValue: unknown) => {
    driftTotal += 1;
    driftByField[field] = (driftByField[field] ?? 0) + 1;
    if (drift.length < driftLimit) drift.push({ internalId, field, fixture: fixtureValue, database: databaseValue });
  };

  for (const entry of fixture) {
    const row = byId.get(entry.internalId);
    if (!row) continue;
    matched += 1;
    const expected = catalogEntryToTitle(entry);
    for (const field of RECONCILED_FIELDS) {
      const fixtureValue = normalize(expected[field]);
      const databaseValue = normalize(row[field]);
      if (fixtureValue !== databaseValue) note(entry.internalId, field, expected[field] ?? null, row[field] ?? null);
    }
    for (const provider of ID_PROVIDERS) {
      const fixtureValue = entry.externalIds?.[provider] ?? null;
      const databaseValue = row.externalIds?.[provider] ?? null;
      if (fixtureValue !== databaseValue) note(entry.internalId, `externalIds.${provider}`, fixtureValue, databaseValue);
    }
  }

  return {
    fixtureEntries: fixture.length,
    titlesExamined: titles.length,
    matched,
    fixtureOnly: fixture.filter((entry) => !byId.has(entry.internalId)).map((entry) => entry.internalId),
    databaseOnly: titles.filter((row) => !fixtureIds.has(row.internalId)).map((row) => row.internalId),
    driftByField,
    drift,
    driftTotal,
  };
}
