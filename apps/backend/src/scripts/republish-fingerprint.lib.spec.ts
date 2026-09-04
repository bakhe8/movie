import { describe, expect, it } from 'vitest';

import { republishFingerprint } from './republish-fingerprint.lib';

const V2 = ['narrative.revelation', 'tone.irony'] as const;
const V3 = ['style.scale'] as const;

describe('republishFingerprint', () => {
  const fingerprint = {
    pacing: 0.5,
    warmth: 0.3,
    confidence: { pacing: 0.8, warmth: 0.6 },
    v2: { features: { 'narrative.revelation': 0.4, 'tone.irony': 0.2 }, confidence: { 'narrative.revelation': 0.5 }, schemaVersion: 'film-fingerprint-v2' },
    v3: { features: { 'style.scale': 0.1 }, confidence: {} },
    generatedBy: 'anthropic',
  };

  it('leaves every value unchanged when the current rows already match what is published', () => {
    const rows = [{ featureKey: 'pacing', value: 0.5, uncertainty: 0.2 }];
    const { fingerprint: out, changes } = republishFingerprint(fingerprint, rows, V2, V3);
    expect(changes).toEqual([]);
    expect(out).toEqual(fingerprint);
    expect(out).not.toBe(fingerprint); // still a copy, never the same object
  });

  it('overlays a corrected V1 value and its confidence, and records the change', () => {
    const rows = [{ featureKey: 'pacing', value: 0.9, uncertainty: 0 }];
    const { fingerprint: out, changes } = republishFingerprint(fingerprint, rows, V2, V3);
    expect(changes).toEqual([{ featureKey: 'pacing', before: 0.5, after: 0.9 }]);
    expect(out.pacing).toBe(0.9);
    expect((out.confidence as Record<string, number>).pacing).toBe(1);
    expect(out.warmth).toBe(0.3); // untouched key stays untouched
    expect(fingerprint.pacing).toBe(0.5); // the input is never mutated
  });

  it('overlays a corrected value inside the v2 and v3 blocks without touching block-level fields', () => {
    const rows = [
      { featureKey: 'tone.irony', value: 0.95, uncertainty: 0 },
      { featureKey: 'style.scale', value: 0.7, uncertainty: 0.1 },
    ];
    const { fingerprint: out, changes } = republishFingerprint(fingerprint, rows, V2, V3);
    expect(changes.map((c) => c.featureKey).sort()).toEqual(['style.scale', 'tone.irony']);
    const v2 = out.v2 as { features: Record<string, number>; confidence: Record<string, number>; schemaVersion: string };
    expect(v2.features['tone.irony']).toBe(0.95);
    expect(v2.features['narrative.revelation']).toBe(0.4); // uncorrected V2 key untouched
    expect(v2.schemaVersion).toBe('film-fingerprint-v2'); // block-level metadata untouched
    const v3 = out.v3 as { features: Record<string, number>; confidence: Record<string, number> };
    expect(v3.features['style.scale']).toBe(0.7);
    expect(v3.confidence['style.scale']).toBe(0.9);
  });

  it('leaves a key untouched when the current row is itself unknown or absent, never inventing or blanking a value', () => {
    const rows = [{ featureKey: 'pacing', value: null, uncertainty: null }];
    const { fingerprint: out, changes } = republishFingerprint(fingerprint, rows, V2, V3);
    expect(changes).toEqual([]);
    expect(out.pacing).toBe(0.5);
  });

  it('passes null and a missing nested block through unchanged', () => {
    expect(republishFingerprint(null, [{ featureKey: 'pacing', value: 0.9, uncertainty: 0 }], V2, V3)).toEqual({ fingerprint: null, changes: [] });
    const noV3 = { pacing: 0.5, confidence: {} };
    const { fingerprint: out, changes } = republishFingerprint(noV3, [{ featureKey: 'style.scale', value: 0.7, uncertainty: 0 }], V2, V3);
    expect(changes).toEqual([]);
    expect(out).toEqual(noV3);
  });
});
