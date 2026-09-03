// Public Quality as `GET /api/titles/:id` returns it since 2026-09-04
// (packages/shared/src/types.ts `PublicQuality`; backend
// modules/public-quality). Mirrored here so this layer needs nothing from
// app/lib/api.ts; session B folds the field into `Title` there (board G3).
export interface PublicQualitySourceView {
  source: string;
  value: number | null;
  scale: string | null;
  votes: number | null;
  capturedAt: string;
  // The line the source requires, verbatim (e.g. IMDb's). Rendered next to
  // the value, never composed on the client (DATA_LICENSING.md §5).
  attribution: string | null;
}

// Sources listed separately, never averaged (BP §10.3); `value`/`votes` are
// set only when exactly one source exists.
export interface PublicQuality {
  value: number | null;
  votes: number | null;
  sources: PublicQualitySourceView[];
}

// Display names for source keys; the key itself is the API's, the label is
// the client's. Unknown keys fall back to the key.
export const SOURCE_LABEL: Record<string, string> = { imdb: 'IMDb' };

// Adapter for WorkCard's transitional `publicQuality` prop
// ({ value, votes, sources: string[] }): the same numbers, source names as
// strings. Attribution is not carried -- WorkCard's cell has no slot for it
// yet, so a surface that uses this adapter must render <PublicQualityCell>
// or the attribution line itself where the value appears.
export function toWorkCardQuality(quality: PublicQuality | null | undefined): { value: number | null; votes: number | null; sources: string[] } | null {
  if (!quality) {
    return null;
  }
  return { value: quality.value, votes: quality.votes, sources: quality.sources.map((s) => SOURCE_LABEL[s.source] ?? s.source) };
}
