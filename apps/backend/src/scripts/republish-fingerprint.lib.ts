/**
 * Republish step (board request C-3 / archive F12): an admin correction to a
 * feature value writes a new `content_features` row (`human-review-v1`) and
 * marks the extracted row `supersededBy` it, but never touches the published
 * `titles.fingerprint` (SCHEMA.md: originals are never edited in place). This
 * is the step that lets a correction reach the trainer and the API: for every
 * key the model reads, if the *current* (non-superseded) row for that
 * (title, featureKey) disagrees with what is published, overlay the row's
 * value (and confidence, `1 - uncertainty`) onto the published block. Nothing
 * else about the block (schemaVersion, themes, generatedBy, modelVersion,
 * extractorVersion) is touched -- content_features rows carry no such
 * block-level metadata, only per-feature provenance, so this is a targeted
 * overlay, never a from-scratch rebuild. A key with no current row, or whose
 * row already matches, is left exactly as published (ADR-19: no value is
 * ever invented or blanked here).
 */
import { DIMENSIONS } from './seed-demo.lib';

export interface CurrentFeatureRow {
  featureKey: string;
  value: number | null;
  uncertainty: number | null;
}

export interface RepublishResult {
  fingerprint: Record<string, unknown>;
  /** `{ featureKey, before, after }` for every value the current rows changed; empty when the published block was already current. */
  changes: { featureKey: string; before: number | null; after: number }[];
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

function overlayBlock(
  values: Record<string, unknown>,
  confidence: Record<string, unknown>,
  keys: readonly string[],
  rowByKey: Map<string, CurrentFeatureRow>,
  changes: RepublishResult['changes'],
): void {
  for (const key of keys) {
    const row = rowByKey.get(key);
    if (!row || row.value === null) {
      continue; // no current row, or the current row is itself unknown: leave what is published (ADR-19)
    }
    const published = values[key];
    if (typeof published !== 'number' || published !== row.value) {
      changes.push({ featureKey: key, before: typeof published === 'number' ? published : null, after: row.value });
      values[key] = row.value;
      if (row.uncertainty !== null) {
        confidence[key] = round3(1 - row.uncertainty);
      }
    }
  }
}

/**
 * `fingerprint` is mutated in a shallow copy (the input object is untouched);
 * `null` (no fingerprint published yet) passes through unchanged -- a title
 * with nothing published is the extraction pipeline's job, not republish's.
 */
export function republishFingerprint(
  fingerprint: Record<string, unknown> | null,
  currentRows: readonly CurrentFeatureRow[],
  v2Dimensions: readonly string[],
  v3Dimensions: readonly string[],
): RepublishResult {
  const changes: RepublishResult['changes'] = [];
  if (!fingerprint) {
    return { fingerprint: fingerprint as unknown as Record<string, unknown>, changes };
  }
  const rowByKey = new Map(currentRows.map((row) => [row.featureKey, row]));
  const result: Record<string, unknown> = { ...fingerprint };
  const confidence = { ...((result.confidence as Record<string, unknown>) ?? {}) };
  overlayBlock(result, confidence, DIMENSIONS, rowByKey, changes);
  result.confidence = confidence;

  for (const [blockKey, dims] of [
    ['v2', v2Dimensions],
    ['v3', v3Dimensions],
  ] as const) {
    const block = result[blockKey];
    if (block && typeof block === 'object') {
      const blockCopy = { ...(block as Record<string, unknown>) };
      const features = { ...((blockCopy.features as Record<string, unknown>) ?? {}) };
      const blockConfidence = { ...((blockCopy.confidence as Record<string, unknown>) ?? {}) };
      overlayBlock(features, blockConfidence, dims, rowByKey, changes);
      blockCopy.features = features;
      blockCopy.confidence = blockConfidence;
      result[blockKey] = blockCopy;
    }
  }
  return { fingerprint: result, changes };
}
