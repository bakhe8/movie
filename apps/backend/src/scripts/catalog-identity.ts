/** CAT-1: identifiers bind cumulatively to one work; names are not identity. */
export const ID_PROVIDERS = ['wikidata', 'imdb', 'tmdb'] as const;
export interface CatalogIdentity {
  internalId: string;
  externalIds?: { wikidata?: string; imdb?: string; tmdb?: string } | null;
}
export interface SourceReservation extends CatalogIdentity {
  wiki: string;
  titleEn: string;
  year: number;
  titleArEvidence?: { title: string; url: string; retrievedAt: string; imdb: string; wikidata: string };
}

export function assertSourceReservations(reserved: readonly SourceReservation[], rows: readonly Omit<SourceReservation, 'externalIds'>[]): void {
  assertUniqueIdentities(reserved);
  assertUniqueIdentities(rows);
  const byId = new Map(reserved.map((row) => [row.internalId, row]));
  if (rows.length !== reserved.length) throw new Error('source list and identity reservations must have the same members');
  for (const row of rows) {
    const old = byId.get(row.internalId);
    if (!old || old.wiki !== row.wiki || old.titleEn !== row.titleEn || old.year !== row.year) {
      throw new Error(`source identity rebind or unreserved work: ${row.internalId}`);
    }
  }
}

const formats = { wikidata: /^Q[1-9]\d*$/, imdb: /^tt\d{7,}$/, tmdb: /^[1-9]\d*$/ };

/** Reject ambiguous spelling instead of silently normalizing an existing binding. */
export function assertUniqueIdentities(rows: readonly CatalogIdentity[]): void {
  const owners = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.internalId !== 'string' || !row.internalId.trim() || row.internalId !== row.internalId.trim()) {
      throw new Error('invalid internalId');
    }
    const keys = [`internalId:${row.internalId}`];
    for (const provider of ID_PROVIDERS) {
      const value = row.externalIds?.[provider];
      if (value === undefined) continue;
      if (typeof value !== 'string' || !formats[provider].test(value)) {
        throw new Error(`${row.internalId}: invalid ${provider} identifier`);
      }
      keys.push(`${provider}:${value}`);
    }
    for (const key of keys) {
      if (owners.has(key)) throw new Error(`identity collision ${key}: ${owners.get(key)} / ${row.internalId}`);
      owners.set(key, row.internalId);
    }
  }
}

/** Existing provider bindings cannot be changed or removed; new ones may be added. */
export function assertCumulativeIdentities(previous: readonly CatalogIdentity[], incoming: readonly CatalogIdentity[], requireAll = false): void {
  assertUniqueIdentities(previous);
  assertUniqueIdentities(incoming);
  const next = new Map(incoming.map((row) => [row.internalId, row]));
  for (const old of previous) {
    const row = next.get(old.internalId);
    if (!row) {
      if (requireAll) throw new Error(`catalog removed ${old.internalId}`);
      continue;
    }
    for (const provider of ID_PROVIDERS) {
      const value = old.externalIds?.[provider];
      if (value !== undefined && row.externalIds?.[provider] !== value) {
        throw new Error(`identity rebind ${old.internalId} ${provider}: ${value} -> ${row.externalIds?.[provider] ?? '(removed)'}`);
      }
    }
  }
  assertUniqueIdentities([...previous.filter((row) => !next.has(row.internalId)), ...incoming]);
}

export function assertReservedIdentities(reserved: readonly CatalogIdentity[], incoming: readonly CatalogIdentity[]): void {
  assertCumulativeIdentities(reserved, incoming);
  const ids = new Set(reserved.map((row) => row.internalId));
  for (const row of incoming) {
    if (!ids.has(row.internalId)) throw new Error(`unreserved work: ${row.internalId}`);
  }
  // Provider additions must be reserved before shipping them in a build/import.
  assertCumulativeIdentities(incoming, reserved);
}

/** A partial refresh cannot erase enrichment, artwork or other admitted works. */
export function mergeCatalog<T extends CatalogIdentity>(previous: readonly T[], incoming: readonly T[]): T[] {
  assertCumulativeIdentities(previous, incoming);
  const next = new Map(previous.map((row) => [row.internalId, row]));
  for (const row of incoming) {
    const old = next.get(row.internalId);
    next.set(row.internalId, old ? { ...row, ...old, externalIds: row.externalIds } : row);
  }
  return [...next.values()].sort((a, b) => a.internalId.localeCompare(b.internalId));
}
