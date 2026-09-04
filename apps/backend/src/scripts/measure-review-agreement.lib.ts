/**
 * Pure half of the human-review acceptance test (board C-4; ALPHA_PLAN 5.5;
 * BP §15.4 "الدقة البشرية"): how closely a human's correction
 * (`admin-catalog.service.ts`'s `reviewContentFeature`, extractorVersion
 * `human-review-v1`) agrees with the extraction it superseded. Agreement is
 * measured, not assumed: a row within `tolerance` of the human's value
 * counts as agreeing; the rate is reported overall and per feature and
 * language, never averaged away (BP §15.4: "no large gap between languages").
 */

export const HUMAN_REVIEW_EXTRACTOR = 'human-review-v1';

/** Default tolerance: half the width of the fingerprint's 0-1 scale's coarsest confidence band, pending real reviewed data to calibrate against. */
export const DEFAULT_TOLERANCE = 0.15;

export interface ReviewedPair {
  featureKey: string;
  /** The value the human recorded (the current, non-superseded row). */
  humanValue: number;
  /** The value the row it superseded held (the model's original extraction). */
  originalValue: number;
  /** The title's original language, when known -- the per-language breakdown BP §15.4 asks for. */
  originalLanguage?: string | null;
}

export interface AgreementRow {
  key: string;
  n: number;
  agreeing: number;
  meanAbsDelta: number;
  rate: number;
}

function summarizeBy(pairs: readonly ReviewedPair[], keyOf: (pair: ReviewedPair) => string, tolerance: number): AgreementRow[] {
  const groups = new Map<string, ReviewedPair[]>();
  for (const pair of pairs) {
    const key = keyOf(pair);
    groups.set(key, [...(groups.get(key) ?? []), pair]);
  }
  return [...groups.entries()]
    .map(([key, members]) => {
      const deltas = members.map((pair) => Math.abs(pair.humanValue - pair.originalValue));
      const agreeing = deltas.filter((delta) => delta <= tolerance).length;
      return { key, n: members.length, agreeing, meanAbsDelta: deltas.reduce((sum, delta) => sum + delta, 0) / members.length, rate: agreeing / members.length };
    })
    .sort((left, right) => left.rate - right.rate || right.n - left.n); // least-agreeing first
}

export function agreementByFeature(pairs: readonly ReviewedPair[], tolerance = DEFAULT_TOLERANCE): AgreementRow[] {
  return summarizeBy(pairs, (pair) => pair.featureKey, tolerance);
}

export function agreementByLanguage(pairs: readonly ReviewedPair[], tolerance = DEFAULT_TOLERANCE): AgreementRow[] {
  return summarizeBy(pairs, (pair) => pair.originalLanguage ?? 'unknown', tolerance);
}

export interface OverallAgreement {
  n: number;
  agreeing: number;
  rate: number | null;
  meanAbsDelta: number | null;
}

export function overallAgreement(pairs: readonly ReviewedPair[], tolerance = DEFAULT_TOLERANCE): OverallAgreement {
  if (pairs.length === 0) {
    return { n: 0, agreeing: 0, rate: null, meanAbsDelta: null };
  }
  const deltas = pairs.map((pair) => Math.abs(pair.humanValue - pair.originalValue));
  const agreeing = deltas.filter((delta) => delta <= tolerance).length;
  return { n: pairs.length, agreeing, rate: agreeing / pairs.length, meanAbsDelta: deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length };
}

/**
 * BP §15.4's language-gap check: the largest agreement-rate gap between any
 * two languages with at least `minSample` reviewed rows each -- meaningless,
 * not zero, when fewer than two languages clear that bar.
 */
export function languageGap(byLanguage: readonly AgreementRow[], minSample = 5): number | null {
  const eligible = byLanguage.filter((row) => row.n >= minSample);
  if (eligible.length < 2) {
    return null;
  }
  const rates = eligible.map((row) => row.rate);
  return Math.max(...rates) - Math.min(...rates);
}

export function formatAgreementReport(
  overall: OverallAgreement,
  byFeature: readonly AgreementRow[],
  byLanguage: readonly AgreementRow[],
  tolerance: number,
  gapBound: number,
): string {
  if (overall.n === 0) {
    return [
      '# Enrichment acceptance — human review agreement (BP §15.4, board C-4)',
      '',
      `No reviewed rows exist yet (no \`${HUMAN_REVIEW_EXTRACTOR}\` correction has superseded an extraction). Nothing to gate on -- run again once the admin board's review queue has been used.`,
      '',
    ].join('\n');
  }
  const gap = languageGap(byLanguage);
  const table = (title: string, rows: readonly AgreementRow[]) => [
    `## ${title}`,
    '',
    '| Key | n | agreeing | mean |Δ| | rate |',
    '|---|---|---|---|---|',
    ...rows.map((row) => `| \`${row.key}\` | ${row.n} | ${row.agreeing} | ${row.meanAbsDelta.toFixed(3)} | ${(row.rate * 100).toFixed(0)}% |`),
    '',
  ];
  return [
    '# Enrichment acceptance — human review agreement (BP §15.4, board C-4)',
    '',
    `${overall.n} reviewed row(s), tolerance ${tolerance} (agree when |human − original| ≤ tolerance).`,
    `Overall agreement: ${overall.agreeing}/${overall.n} = ${((overall.rate ?? 0) * 100).toFixed(0)}%, mean |Δ| ${overall.meanAbsDelta?.toFixed(3)}.`,
    gap === null
      ? `Language gap: not yet measurable (fewer than two languages with 5+ reviewed rows).`
      : `Language gap: ${(gap * 100).toFixed(0)} points ${gap > gapBound ? `— **over the ${(gapBound * 100).toFixed(0)}-point bound**` : `(within the ${(gapBound * 100).toFixed(0)}-point bound)`}.`,
    '',
    ...table('By feature (least agreement first)', byFeature),
    ...table('By original language', byLanguage),
  ].join('\n');
}
