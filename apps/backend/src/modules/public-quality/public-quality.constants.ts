// Public Quality sources (BP §10.3): one row per (title, source), never
// averaged into one number. The first and, during the free period, only
// source is IMDb's non-commercial datasets (owner decision 2026-09-04,
// DATA_LICENSING.md §3.2): official dumps only, one rights-registry row per
// value, the attribution line below rendered wherever a value is shown, no
// bulk redistribution.

export const IMDB_SOURCE = 'imdb';
export const IMDB_SCALE = '0-10';

export const IMDB_LICENSE = 'IMDb non-commercial datasets: personal and non-commercial use, attribution required, no redistribution';

// The attribution IMDb's dataset page requires, verbatim. Keyed by the
// `public_quality_sources.source` value so the API can attach it to every
// value it returns; the UI never hard-codes it (DATA_LICENSING.md §5). The
// M3 rights registry has `attributionRequired` but no text column for the
// line itself -- a dedicated column is a later migration, and until then the
// backend, not the UI, is the single place the line lives.
export const ATTRIBUTION_BY_SOURCE: Record<string, string> = {
  [IMDB_SOURCE]: 'Information courtesy of IMDb (https://www.imdb.com). Used with permission.',
  // Catalog text and facts (ALPHA_PLAN 5.1, scripts/load-catalog-rights.ts):
  // CC BY-SA needs the license named and a link to the page (the page URL is
  // the registry row's `value`); CC0 needs nothing, credited anyway.
  'wikipedia:en': 'Text from Wikipedia, licensed CC BY-SA 4.0',
  'wikipedia:ar': 'Text from Wikipedia, licensed CC BY-SA 4.0',
  wikidata: 'Data from Wikidata (CC0)',
};

// DATA_LICENSING.md §0: while the service earns nothing, a value with a
// known non-commercial status is displayable; 'unknown' and
// 'pending_review' are not (BP App. B: nothing shown without a known
// license status).
export const DISPLAYABLE_LICENSE_STATUSES = ['commercial_allowed', 'non_commercial_only'] as const;
